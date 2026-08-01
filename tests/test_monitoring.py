from __future__ import annotations

import json
import sqlite3
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

import api.main as api_main
from api import monitoring
from api.medplum import MedplumError
from api.models import (
    GroundedMonitoringResult,
    MedplumCaseContext,
    MedplumConditionContext,
    MedplumMedicationContext,
    MedplumObservationContext,
)
from api.monitoring import MonitoringError, MonitoringRunContext
from lamina_directory.seed_demo_physician import (
    DEMO_AGENT_ID,
    DEMO_NPI,
    LIANNE_AGENT_ID,
    LIANNE_NPI,
    seed_demo_physician,
)

FHIR_SECRET_VALUES = {
    "ethan-secret-patient",
    "lianne-strong-secret",
    "lianne-near-miss-secret",
    "condition-secret-id",
    "observation-secret-id",
    "medication-secret-id",
    "practitioner-lianne-secret",
    "practitioner-ethan-secret",
}
FHIR_REFERENCE_PREFIXES = (
    "Patient/",
    "Condition/",
    "Observation/",
    "MedicationRequest/",
    "Practitioner/",
)


def assert_no_medplum_identifiers(payload) -> None:
    encoded = json.dumps(payload)
    normalized = encoded.casefold()
    assert "source_resource_refs" not in encoded
    assert "patient_id" not in encoded
    for value in FHIR_SECRET_VALUES:
        assert value not in encoded
    for prefix in FHIR_REFERENCE_PREFIXES:
        assert prefix.casefold() not in normalized


def case_context(patient_id: str, *, strong: bool = True) -> MedplumCaseContext:
    observations = [
        MedplumObservationContext(
            display="Nausea symptom",
            value_summary="Persistent nausea",
            effective_date="2026-07-15",
        )
    ]
    if strong:
        observations.extend(
            [
                MedplumObservationContext(
                    display="Serum bicarbonate",
                    value_summary="15 mmol/L; low",
                    effective_date="2026-07-15",
                ),
                MedplumObservationContext(
                    display="Anion gap",
                    value_summary="21 mmol/L; elevated",
                    effective_date="2026-07-15",
                ),
                MedplumObservationContext(
                    display="Physician-recorded outcome",
                    value_summary="Euglycemic diabetic ketoacidosis documented",
                    effective_date="2026-07-16",
                ),
            ]
        )
    else:
        observations.append(
            MedplumObservationContext(
                display="Serum bicarbonate",
                value_summary="24 mmol/L; normal",
                effective_date="2026-07-15",
            )
        )
    return MedplumCaseContext(
        patient_id=patient_id,
        synthetic=True,
        age_band="40-49",
        conditions=[
            MedplumConditionContext(
                display="Type 2 diabetes mellitus", clinical_status="Active"
            )
        ],
        medications=[
            MedplumMedicationContext(
                display=(
                    "Empagliflozin (SGLT2 inhibitor)"
                    if strong
                    else "Metformin extended-release"
                ),
                status="active",
                timing_summary="Medication exposure before symptoms",
            )
        ],
        observations=observations,
        source_resource_refs=[
            f"Patient/{patient_id}",
            "Condition/condition-secret-id",
            "Observation/observation-secret-id",
            "MedicationRequest/medication-secret-id",
        ],
    )


class FakePanelMedplum:
    def __init__(self) -> None:
        self.source = case_context("ethan-secret-patient")
        self.panels = {
            "practitioner-lianne-secret": [
                case_context("lianne-strong-secret"),
                case_context("lianne-near-miss-secret", strong=False),
            ],
            "practitioner-ethan-secret": [self.source],
        }

    async def get_case_context(self, patient_id):
        assert patient_id == "ethan-secret-patient"
        return self.source

    async def get_authorized_panel_cases(self, practitioner_id):
        return self.panels.get(practitioner_id, [])

    async def get_authorized_case_context(self, practitioner_id, patient_id):
        for case in await self.get_authorized_panel_cases(practitioner_id):
            if case.patient_id == patient_id:
                return case
        raise MedplumError("medplum_patient_outside_practitioner_panel")


class FakeRuntime:
    model = "fake-agent-model"

    def __init__(self, mode: str = "draft") -> None:
        self.mode = mode
        self.calls = 0

    async def run(self, context: MonitoringRunContext) -> GroundedMonitoringResult:
        self.calls += 1
        candidates = await context.search_cases(5)
        if self.mode == "abstain":
            return GroundedMonitoringResult.model_validate(
                {
                    "relevance": {
                        "is_relevant": False,
                        "confidence": "low",
                        "concise_reason": "No sufficiently similar retrieved case.",
                    },
                    "matching_case_refs": [],
                    "similarities": [],
                    "differences": [],
                    "unknowns": ["No supporting case was retrieved."],
                    "action": "no_response",
                    "response_draft": None,
                    "grounding_summary": {"source": "medplum", "matched_case_count": 0},
                }
            )
        first_ref = candidates[0]["case_ref"]
        await context.get_case_summary(first_ref)
        returned_ref = "case-invented" if self.mode == "fake_ref" else first_ref
        content = (
            "The patient recovered after an unsupported intervention."
            if self.mode == "unsupported_outcome"
            else "In one retrieved synthetic case, SGLT2 inhibitor exposure, nausea, and a low-bicarbonate pattern were documented. This does not establish a diagnosis for the current case."
        )
        return GroundedMonitoringResult.model_validate(
            {
                "relevance": {
                    "is_relevant": True,
                    "confidence": "high",
                    "concise_reason": "A retrieved synthetic case shares medication and laboratory patterns.",
                },
                "matching_case_refs": [returned_ref],
                "similarities": ["SGLT2 inhibitor exposure and low bicarbonate were present."],
                "differences": ["The question author's diagnosis remains unknown."],
                "unknowns": ["Causation is not established."],
                "action": "draft_response",
                "response_draft": {
                    "response_type": "clinical_consideration",
                    "headline": "A similar synthetic presentation was documented",
                    "content": content,
                },
                "grounding_summary": {"source": "medplum", "matched_case_count": 1},
            }
        )


@pytest.fixture
def client(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    database = tmp_path / "lamina.sqlite"
    schema = Path(__file__).parents[1] / "sql" / "schema.sql"
    with sqlite3.connect(database) as connection:
        connection.executescript(schema.read_text(encoding="utf-8"))
    seed_demo_physician(database)
    monkeypatch.setattr(api_main, "DB_PATH", database)
    api_main.app.dependency_overrides.clear()
    http = TestClient(api_main.app)
    for npi, agent_id, topics in (
        (DEMO_NPI, DEMO_AGENT_ID, ["Clinical AI"]),
        (LIANNE_NPI, LIANNE_AGENT_ID, ["Medication Safety", "Diabetes"]),
    ):
        claim = http.post(f"/physicians/{npi}/claims").json()["claim"]
        http.post(f"/claims/{claim['id']}/verify-demo")
        http.put(
            f"/agents/{agent_id}/configuration",
            json={
                "monitoring_topics": topics,
                "voice_post_drafting_enabled": True,
                "response_drafting_enabled": True,
            },
        )
        http.post(f"/agents/{agent_id}/activate")
    with sqlite3.connect(database) as connection:
        now = "2026-07-31T12:00:00Z"
        connection.executemany(
            """
            INSERT INTO medplum_practitioner_links
              (agent_id, physician_npi, medplum_practitioner_id, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?)
            """,
            [
                (DEMO_AGENT_ID, DEMO_NPI, "practitioner-ethan-secret", now, now),
                (LIANNE_AGENT_ID, LIANNE_NPI, "practitioner-lianne-secret", now, now),
            ],
        )
    yield http, database
    api_main.app.dependency_overrides.clear()


def create_published_linked_post(http: TestClient, database: Path, *, title=None) -> str:
    post = http.post(
        "/forum/posts/drafts",
        json={
            "agent_id": DEMO_AGENT_ID,
            "title": title or "Nausea with unusual metabolic pattern after SGLT2 inhibitor",
            "clinical_question": "Have others encountered a similar diabetes medication presentation?",
            "context_summary": "Synthetic adult with nausea, fatigue, low bicarbonate, and elevated anion gap.",
            "specialty_tags": ["Endocrinology", "Medication Safety"],
            "case_classification": "synthetic",
        },
    ).json()
    with sqlite3.connect(database) as connection:
        connection.execute(
            """
            INSERT INTO forum_medplum_links (
              id, post_id, medplum_patient_id, medplum_condition_ids_json,
              medplum_medication_request_ids_json, medplum_observation_ids_json,
              source_type, created_by_agent_id, created_at, updated_at
            ) VALUES (?, ?, 'ethan-secret-patient', '[]', '[]', '[]',
                      'medplum_synthetic_patient', ?, ?, ?)
            """,
            ("link-" + post["id"], post["id"], DEMO_AGENT_ID, "2026-07-31T12:00:00Z", "2026-07-31T12:00:00Z"),
        )
    http.post(f"/forum/posts/{post['id']}/approve", json={"physician_npi": DEMO_NPI})
    return post["id"]


def override(http, medplum, runtime):
    del http
    api_main.app.dependency_overrides[api_main.get_medplum_service] = lambda: medplum
    api_main.app.dependency_overrides[api_main.get_monitoring_runtime] = lambda: runtime


def test_grounded_monitoring_draft_review_approval_and_idempotency(client):
    http, database = client
    post_id = create_published_linked_post(http, database)
    runtime = FakeRuntime()
    override(http, FakePanelMedplum(), runtime)
    monitored = http.post(f"/forum/posts/{post_id}/monitor")
    assert monitored.status_code == 200
    result = monitored.json()["results"][0]
    assert result["agent_id"] == LIANNE_AGENT_ID
    assert result["outcome"] == "draft_created"
    response_id = result["response_id"]
    assert result["matched_case_count"] == 1
    assert http.get(f"/physicians/{LIANNE_NPI}/review-inbox").json()["counts"]["responses"] == 1
    assert http.get(f"/forum/posts/{post_id}").json()["responses"] == []

    private = http.get(
        f"/forum/responses/{response_id}/grounding-review",
        params={"physician_npi": LIANNE_NPI},
    ).json()
    assert private["grounding"]["matched_case_count"] == 1
    assert_no_medplum_identifiers(private)
    denied = http.get(
        f"/forum/responses/{response_id}/grounding-review",
        params={"physician_npi": DEMO_NPI},
    )
    assert denied.status_code == 403
    assert http.post(
        f"/forum/responses/{response_id}/approve", json={"physician_npi": DEMO_NPI}
    ).status_code == 403
    approved = http.post(
        f"/forum/responses/{response_id}/approve", json={"physician_npi": LIANNE_NPI}
    )
    assert approved.status_code == 200
    public = http.get(f"/forum/posts/{post_id}").json()["responses"][0]
    assert public["provenance"]["grounding"] == {
        "grounding_mode": "medplum_case_match",
        "source_system": "medplum",
        "matched_case_count": 1,
    }
    assert set(public["provenance"]["grounding"]) == {
        "grounding_mode",
        "source_system",
        "matched_case_count",
    }
    assert "case-" not in json.dumps(public)
    assert_no_medplum_identifiers(public)
    repeated = http.post(f"/forum/posts/{post_id}/monitor").json()
    assert repeated["results"][0]["response_id"] == response_id
    assert runtime.calls == 1
    with sqlite3.connect(database) as connection:
        assert connection.execute("SELECT count(*) FROM forum_responses").fetchone()[0] == 1


@pytest.mark.parametrize(
    "mode,expected",
    [
        ("abstain", "no_relevant_case"),
        ("fake_ref", "failed"),
        ("unsupported_outcome", "failed"),
    ],
)
def test_abstention_and_fake_refs_create_no_response(client, mode, expected):
    http, database = client
    post_id = create_published_linked_post(http, database)
    override(http, FakePanelMedplum(), FakeRuntime(mode))
    result = http.post(f"/forum/posts/{post_id}/monitor").json()["results"][0]
    assert result["outcome"] == expected
    assert result["response_id"] is None
    with sqlite3.connect(database) as connection:
        assert connection.execute("SELECT count(*) FROM forum_responses").fetchone()[0] == 0


def test_unrelated_or_paused_agents_do_not_invoke_runtime(client):
    http, database = client
    post_id = create_published_linked_post(
        http, database, title="Synthetic dermatology image discussion"
    )
    with sqlite3.connect(database) as connection:
        connection.execute(
            "UPDATE forum_posts SET clinical_question='Discuss a synthetic rash image', context_summary='Synthetic visual finding only', specialty_tags_json='[\"Dermatology\"]' WHERE id=?",
            (post_id,),
        )
    runtime = FakeRuntime()
    override(http, FakePanelMedplum(), runtime)
    result = http.post(f"/forum/posts/{post_id}/monitor").json()["results"][0]
    assert result["outcome"] == "skipped"
    assert runtime.calls == 0
    http.post(f"/agents/{LIANNE_AGENT_ID}/pause")
    other_post = create_published_linked_post(http, database)
    monitored = http.post(f"/forum/posts/{other_post}/monitor").json()
    assert monitored["agents_evaluated"] == 0


@pytest.mark.anyio
async def test_opaque_refs_are_run_and_physician_scoped():
    medplum = FakePanelMedplum()
    context = MonitoringRunContext(
        monitoring_run_id="run-one",
        agent_id=LIANNE_AGENT_ID,
        physician_npi=LIANNE_NPI,
        physician_display_name="Lianne Cha, MD",
        verified_specialties=["Endocrinology"],
        monitoring_topics=["Diabetes"],
        permitted_medplum_practitioner_id="practitioner-lianne-secret",
        current_post_id="post-one",
        post_context={"synthetic": True},
        source_case_context=medplum.source,
        medplum=medplum,
    )
    results = await context.search_cases(5)
    assert results[0]["case_ref"].startswith("case-")
    assert set(results[0]) == {
        "case_ref",
        "case_similarity_score",
        "why_matched",
        "high_level_facts",
    }
    assert_no_medplum_identifiers(results)
    summary = await context.get_case_summary(results[0]["case_ref"])
    assert_no_medplum_identifiers(summary)
    assert_no_medplum_identifiers(context.execution_trace)
    with pytest.raises(MonitoringError, match="not_authorized"):
        await context.get_case_summary("case-invented")
    other_run = MonitoringRunContext(
        **{**context.__dict__, "monitoring_run_id": "run-two", "candidate_case_refs": {}, "candidate_metadata": {}, "retrieved_case_refs": set(), "execution_trace": ["post_loaded"]}
    )
    with pytest.raises(MonitoringError, match="not_authorized"):
        await other_run.get_case_summary(results[0]["case_ref"])
    other_agent = MonitoringRunContext(
        **{
            **context.__dict__,
            "agent_id": DEMO_AGENT_ID,
            "candidate_case_refs": {},
            "candidate_metadata": {},
            "retrieved_case_refs": set(),
            "execution_trace": ["post_loaded"],
        }
    )
    other_results = await other_agent.search_cases(5)
    assert other_results[0]["case_ref"] != results[0]["case_ref"]
    with pytest.raises(MonitoringError, match="not_authorized"):
        await other_agent.get_case_summary(results[0]["case_ref"])


@pytest.mark.anyio
async def test_actual_sdk_runtime_builds_agent_runner_and_controlled_tools(monkeypatch):
    captured = {}

    async def fake_run(agent, input, **kwargs):
        captured["agent"] = agent
        captured["input"] = input
        captured["kwargs"] = kwargs
        return SimpleNamespace(
            final_output={
                "relevance": {
                    "is_relevant": False,
                    "confidence": "low",
                    "concise_reason": "No response after bounded evaluation.",
                },
                "matching_case_refs": [],
                "similarities": [],
                "differences": [],
                "unknowns": [],
                "action": "no_response",
                "response_draft": None,
                "grounding_summary": {"source": "medplum", "matched_case_count": 0},
            }
        )

    monkeypatch.setattr(monitoring.Runner, "run", fake_run)
    medplum = FakePanelMedplum()
    context = MonitoringRunContext(
        monitoring_run_id="run-sdk",
        agent_id=LIANNE_AGENT_ID,
        physician_npi=LIANNE_NPI,
        physician_display_name="Lianne Cha, MD",
        verified_specialties=["Endocrinology"],
        monitoring_topics=["Diabetes"],
        permitted_medplum_practitioner_id="practitioner-lianne-secret",
        current_post_id="post-sdk",
        post_context={"synthetic": True},
        source_case_context=medplum.source,
        medplum=medplum,
    )
    runtime = monitoring.AgentsMonitoringRuntime(
        monitoring.MonitoringSettings("test-model", 5, False)
    )
    result = await runtime.run(context)
    assert result.action == "no_response"
    assert {tool.name for tool in captured["agent"].tools} == {
        "get_published_post_context",
        "search_my_similar_cases",
        "get_my_case_summary",
    }
    tool_definitions = [
        {
            "name": tool.name,
            "description": tool.description,
            "parameters": tool.params_json_schema,
        }
        for tool in captured["agent"].tools
    ]
    assert_no_medplum_identifiers(tool_definitions)
    assert captured["kwargs"]["max_turns"] == 8
    assert captured["kwargs"]["run_config"].tracing_disabled is True
    assert captured["kwargs"]["run_config"].trace_include_sensitive_data is False
    assert_no_medplum_identifiers(captured["input"])
    assert_no_medplum_identifiers(captured["agent"].instructions)
    assert "Workflow state belongs only in application metadata" in (
        captured["agent"].instructions
    )
    assert "Do not narrate empty citation metadata" in captured["agent"].instructions
    assert_no_medplum_identifiers(context.post_context)
