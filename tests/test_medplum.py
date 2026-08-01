from __future__ import annotations

import json
import sqlite3
from copy import deepcopy
from pathlib import Path
from urllib.parse import parse_qs

import httpx
import pytest
from fastapi.testclient import TestClient

import api.main as api_main
from api.medplum import (
    SYNTHETIC_TAG,
    MedplumClientService,
    MedplumError,
    MedplumSettings,
)
from api.models import (
    GeneratedPostDraft,
    MedplumCaseContext,
    MedplumConditionContext,
    MedplumMedicationContext,
    MedplumObservationContext,
)
from api.openai_generation import (
    MEDPLUM_POST_PROMPT_VERSION,
    GenerationError,
    GenerationResult,
)
from lamina_directory.seed_demo_physician import (
    DEMO_AGENT_ID,
    DEMO_NPI,
    LIANNE_AGENT_ID,
    LIANNE_NPI,
    seed_demo_physician,
)


def settings() -> MedplumSettings:
    return MedplumSettings(
        base_url="https://example.medplum.test",
        token_url="https://example.medplum.test/oauth2/token",
        fhir_base_url="https://example.medplum.test/fhir/R4",
        client_id="client-id",
        client_secret="client-secret-marker",
        project_id="project-id",
        timeout_seconds=5,
    )


class FhirBackend:
    def __init__(self) -> None:
        self.token_requests = 0
        self.fhir_requests = 0
        self.force_first_401 = False
        self.resources: dict[str, dict[str, dict[str, object]]] = {
            resource_type: {}
            for resource_type in (
                "Practitioner",
                "Patient",
                "Condition",
                "MedicationRequest",
                "Observation",
                "Communication",
            )
        }

    def __call__(self, request: httpx.Request) -> httpx.Response:
        if request.url.path == "/oauth2/token":
            self.token_requests += 1
            assert request.headers["authorization"].startswith("Basic ")
            assert parse_qs(request.content.decode())["grant_type"] == ["client_credentials"]
            return httpx.Response(
                200,
                json={"access_token": f"token-{self.token_requests}", "expires_in": 300},
            )
        self.fhir_requests += 1
        if self.force_first_401 and self.fhir_requests == 1:
            return httpx.Response(401, json={"resourceType": "OperationOutcome"})
        relative = request.url.path.split("/fhir/R4/", 1)[1]
        if relative == "metadata":
            return httpx.Response(200, json={"resourceType": "CapabilityStatement"})
        parts = relative.split("/")
        resource_type = parts[0]
        if request.method == "GET" and len(parts) == 2:
            resource = self.resources[resource_type].get(parts[1])
            return httpx.Response(200, json=resource) if resource else httpx.Response(404)
        if request.method == "GET":
            values = list(self.resources[resource_type].values())
            identifier = request.url.params.get("identifier")
            subject = request.url.params.get("subject")
            if identifier:
                system, value = identifier.split("|", 1)
                values = [
                    item
                    for item in values
                    if any(
                        entry.get("system") == system and entry.get("value") == value
                        for entry in item.get("identifier", [])
                    )
                ]
            if subject:
                values = [
                    item
                    for item in values
                    if item.get("subject", {}).get("reference") == subject
                ]
            return httpx.Response(
                200,
                json={
                    "resourceType": "Bundle",
                    "entry": [{"resource": item} for item in values],
                },
            )
        body = json.loads(request.content)
        assert request.headers["content-type"] == "application/fhir+json"
        if request.method == "POST":
            resource_id = f"{resource_type.lower()}-{len(self.resources[resource_type]) + 1}"
        else:
            resource_id = parts[1]
        body["id"] = resource_id
        body.setdefault("meta", {})["versionId"] = "1"
        self.resources[resource_type][resource_id] = body
        return httpx.Response(200 if request.method == "PUT" else 201, json=body)


class FakeMedplumService:
    def __init__(self, *, error: str | None = None) -> None:
        self.error = error
        self.exports: list[dict[str, object]] = []
        self.context = MedplumCaseContext(
            patient_id="patient-secret-id",
            synthetic=True,
            age_band="40–49",
            conditions=[
                MedplumConditionContext(
                    display="Type 2 diabetes mellitus", clinical_status="Active"
                )
            ],
            medications=[
                MedplumMedicationContext(
                    display="Metformin extended-release",
                    status="active",
                    timing_summary="Dose recently changed",
                )
            ],
            observations=[
                MedplumObservationContext(
                    display="Nausea symptom",
                    value_summary="Persistent nausea",
                    effective_date="2026-07-15",
                )
            ],
            source_resource_refs=[
                "Condition/condition-secret-id",
                "MedicationRequest/medication-secret-id",
                "Observation/observation-secret-id",
            ],
        )

    async def health(self):
        if self.error:
            raise MedplumError(self.error)
        return {
            "configured": True,
            "authenticated": True,
            "fhir_reachable": True,
            "project_id_configured": True,
        }

    async def get_case_context(self, patient_id):
        if self.error:
            raise MedplumError(self.error)
        return self.context.model_copy(update={"patient_id": patient_id})

    async def get_authorized_panel_cases(self, practitioner_id):
        del practitioner_id
        if self.error:
            raise MedplumError(self.error)
        return [
            self.context,
            self.context.model_copy(update={"patient_id": "patient-id"}),
        ]

    async def get_authorized_case_context(self, practitioner_id, patient_id):
        cases = await self.get_authorized_panel_cases(practitioner_id)
        for case in cases:
            if case.patient_id == patient_id:
                return case
        raise MedplumError("medplum_patient_outside_practitioner_panel")

    async def seed_demo_patient(self):
        return {}

    async def export_discussion(self, **kwargs):
        if self.error:
            raise MedplumError(self.error)
        self.exports.append(kwargs)
        return {"communication_id": "communication-1", "status": "completed"}


class FakeGenerationService:
    def __init__(self, *, fail: bool = False) -> None:
        self.fail = fail
        self.medplum_calls: list[tuple[dict, dict, str]] = []

    async def generate_medplum_post(self, context, case_facts, physician_guidance):
        self.medplum_calls.append((context, case_facts, physician_guidance))
        if self.fail:
            raise GenerationError("openai_timeout")
        return GenerationResult(
            output=GeneratedPostDraft(
                title="Synthetic nausea after medication change",
                clinical_question="What medication timing and history should be clarified?",
                context_summary="Synthetic adult in the 40–49 age band.",
                specialty_tags=["Internal Medicine", "Endocrinology"],
                uncertainties=["Exact dose relationship is unknown."],
            ),
            model="fake-model",
            prompt_version=MEDPLUM_POST_PROMPT_VERSION,
            provider_response_id="response-fake",
        )


@pytest.fixture
def client(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    database = tmp_path / "lamina.sqlite"
    schema = Path(__file__).parents[1] / "sql" / "schema.sql"
    with sqlite3.connect(database) as connection:
        connection.executescript(schema.read_text(encoding="utf-8"))
        connection.execute(
            """
            INSERT INTO physicians (npi, display_name, primary_specialty, source)
            VALUES ('1234567890', 'Existing NPPES Physician, MD', 'Cardiology', 'NPPES')
            """
        )
        connection.execute(
            "INSERT INTO agents (id, physician_npi) VALUES ('agent-1234567890', '1234567890')"
        )
    seed_demo_physician(database)
    with sqlite3.connect(database) as connection:
        connection.executemany(
            """
            INSERT INTO medplum_practitioner_links (
              agent_id, physician_npi, medplum_practitioner_id, organization_id,
              medplum_connection_id, created_at, updated_at
            ) VALUES (?, ?, ?, 'org-lamina-demo-medical-group',
                      'medplum-lamina-demo-medical-group', 'now', 'now')
            """,
            [
                (DEMO_AGENT_ID, DEMO_NPI, "practitioner-ethan"),
                (LIANNE_AGENT_ID, LIANNE_NPI, "practitioner-lianne"),
            ],
        )
    monkeypatch.setattr(api_main, "DB_PATH", database)
    api_main.app.dependency_overrides.clear()
    yield TestClient(api_main.app), database
    api_main.app.dependency_overrides.clear()


def activate(client, npi, agent_id, *, voice=False, responses=False):
    claim = client.post(f"/physicians/{npi}/claims").json()["claim"]
    client.post(f"/claims/{claim['id']}/verify-demo")
    client.put(
        f"/agents/{agent_id}/configuration",
        json={
            "voice_post_drafting_enabled": voice,
            "response_drafting_enabled": responses,
        },
    )
    client.post(f"/agents/{agent_id}/activate")


def override_services(medplum, generation=None):
    api_main.app.dependency_overrides[api_main.get_medplum_service] = lambda: medplum
    if generation:
        api_main.app.dependency_overrides[api_main.get_generation_service] = lambda: generation


def test_missing_configuration_is_safe_and_non_medplum_routes_work(client, monkeypatch):
    http, database = client
    for name in (
        "MEDPLUM_BASE_URL",
        "MEDPLUM_TOKEN_URL",
        "MEDPLUM_CLIENT_ID",
        "MEDPLUM_CLIENT_SECRET",
        "MEDPLUM_PROJECT_ID",
    ):
        monkeypatch.delenv(name, raising=False)
    assert http.get("/health").status_code == 200
    health = http.get("/integrations/medplum/health")
    assert health.status_code == 200
    assert health.json()["configured"] is False
    error = http.get("/medplum/patients/example/case-context")
    assert error.status_code == 503
    assert "secret" not in error.text.casefold()
    with sqlite3.connect(database) as connection:
        events = connection.execute(
            "SELECT action, metadata_json FROM integration_audit_events ORDER BY created_at"
        ).fetchall()
    medplum_events = [
        event
        for event in events
        if event[0] in {"medplum_health_check_failed", "medplum_case_context_read_failed"}
    ]
    assert [event[0] for event in medplum_events] == [
        "medplum_health_check_failed",
        "medplum_case_context_read_failed",
    ]
    assert "secret" not in json.dumps(events).casefold()


@pytest.mark.parametrize(
    ("category", "expected_detail"),
    [
        ("medplum_authentication_failed", "authentication failed"),
        ("medplum_access_denied", "access was denied"),
        ("medplum_token_timeout", "token endpoint is unreachable"),
        ("medplum_fhir_unreachable", "FHIR endpoint is unreachable"),
    ],
)
def test_medplum_health_errors_are_safe_and_distinct(client, category, expected_detail):
    http, _ = client
    override_services(FakeMedplumService(error=category))
    response = http.get("/integrations/medplum/health")
    assert response.status_code in {502, 503}
    assert expected_detail in response.json()["detail"]
    assert "client-secret-marker" not in response.text
    assert "token-" not in response.text


@pytest.mark.anyio
async def test_client_credentials_token_cache_and_401_refresh():
    backend = FhirBackend()
    backend.force_first_401 = True
    service = MedplumClientService(settings(), transport=httpx.MockTransport(backend))
    assert (await service.health())["authenticated"] is True
    assert backend.token_requests == 2
    await service.health()
    assert backend.token_requests == 2


@pytest.mark.anyio
async def test_seed_is_tagged_linked_and_idempotent():
    backend = FhirBackend()
    service = MedplumClientService(settings(), transport=httpx.MockTransport(backend))
    first = await service.seed_demo_panel()
    second = await service.seed_demo_panel()
    assert first == second
    assert len(backend.resources["Practitioner"]) == 2
    assert len(backend.resources["Patient"]) == 4
    for resources in backend.resources.values():
        for resource in resources.values():
            assert SYNTHETIC_TAG in resource["meta"]["tag"]
    ethan = first["cases"]["ethan_index"]
    patient_ref = f"Patient/{ethan['Patient']}"
    assert backend.resources["Patient"][ethan["Patient"]]["generalPractitioner"] == [
        {"reference": f"Practitioner/{first['practitioners']['ethan']}"}
    ]
    for resource_type in ("Condition", "MedicationRequest", "Observation"):
        for resource_id in ethan[resource_type]:
            assert backend.resources[resource_type][resource_id]["subject"]["reference"] == patient_ref


@pytest.mark.anyio
async def test_authorized_case_context_enforces_practitioner_panel():
    backend = FhirBackend()
    service = MedplumClientService(settings(), transport=httpx.MockTransport(backend))
    seeded = await service.seed_demo_panel()
    ethan_patient = seeded["cases"]["ethan_index"]["Patient"]

    context = await service.get_authorized_case_context(
        seeded["practitioners"]["ethan"], ethan_patient
    )

    assert context.patient_id == ethan_patient
    with pytest.raises(MedplumError, match="medplum_patient_outside_practitioner_panel"):
        await service.get_authorized_case_context(
            seeded["practitioners"]["lianne"], ethan_patient
        )


@pytest.mark.anyio
async def test_case_context_excludes_identity_and_unrelated_resources():
    backend = FhirBackend()
    service = MedplumClientService(settings(), transport=httpx.MockTransport(backend))
    ids = await service.seed_demo_patient()
    backend.resources["Observation"]["unrelated"] = {
        "resourceType": "Observation",
        "id": "unrelated",
        "meta": {"tag": [SYNTHETIC_TAG]},
        "subject": {"reference": "Patient/other"},
        "status": "final",
        "code": {"text": "Private unrelated observation"},
    }
    context = await service.get_case_context(ids["Patient"])
    payload = context.model_dump_json()
    assert context.synthetic is True
    assert context.age_band == "40–49"
    assert len(context.conditions) == 1
    assert len(context.medications) == 2
    assert len(context.observations) == 7
    assert "Alex" not in payload
    assert "Lamina-Demo" not in payload
    assert "1985-06-15" not in payload
    assert "unrelated" not in payload
    assert "three days after medication change" in payload


async def seeded_case_service():
    backend = FhirBackend()
    service = MedplumClientService(settings(), transport=httpx.MockTransport(backend))
    ids = await service.seed_demo_patient()
    return backend, service, ids


def duplicate_resource(
    backend: FhirBackend,
    resource_type: str,
    source_id: str,
    duplicate_id: str,
) -> dict[str, object]:
    duplicate = deepcopy(backend.resources[resource_type][source_id])
    duplicate["id"] = duplicate_id
    duplicate["identifier"] = [
        {
            "system": f"https://lamina.health/fhir/test-{resource_type.casefold()}",
            "value": duplicate_id,
        }
    ]
    backend.resources[resource_type][duplicate_id] = duplicate
    return duplicate


@pytest.mark.anyio
async def test_case_context_deduplicates_exact_condition_facts():
    backend, service, ids = await seeded_case_service()
    duplicate_resource(
        backend,
        "Condition",
        ids["Condition"],
        "condition-exact-duplicate",
    )

    context = await service.get_case_context(ids["Patient"])

    assert len(context.conditions) == 1
    assert context.conditions[0].display == "Type 2 diabetes mellitus"
    assert f"Condition/{ids['Condition']}" in context.source_resource_refs
    assert "Condition/condition-exact-duplicate" in context.source_resource_refs


@pytest.mark.anyio
async def test_case_context_deduplicates_exact_observation_facts():
    backend, service, ids = await seeded_case_service()
    duplicate_resource(
        backend,
        "Observation",
        ids["Observation"],
        "observation-exact-duplicate",
    )

    context = await service.get_case_context(ids["Patient"])

    nausea = [item for item in context.observations if item.display == "Nausea symptom"]
    assert len(nausea) == 1
    assert "Observation/observation-exact-duplicate" in context.source_resource_refs


@pytest.mark.anyio
async def test_case_context_deduplicates_exact_medication_requests():
    backend, service, ids = await seeded_case_service()
    duplicate_resource(
        backend,
        "MedicationRequest",
        ids["MedicationRequest"],
        "medication-exact-duplicate",
    )

    context = await service.get_case_context(ids["Patient"])

    metformin = [
        item for item in context.medications if item.display == "Metformin extended-release"
    ]
    assert len(metformin) == 1
    assert metformin[0].timing_summary == "Stable background medication."
    assert "MedicationRequest/medication-exact-duplicate" in context.source_resource_refs


@pytest.mark.anyio
async def test_case_context_combines_meaningful_states_for_the_same_medication():
    backend, service, ids = await seeded_case_service()
    changed = duplicate_resource(
        backend,
        "MedicationRequest",
        ids["MedicationRequest"],
        "medication-dose-change",
    )
    changed["dosageInstruction"] = [{"text": "Dose increased recently."}]

    context = await service.get_case_context(ids["Patient"])

    metformin = [
        item for item in context.medications if item.display == "Metformin extended-release"
    ]
    assert len(metformin) == 1
    assert metformin[0].status == "active"
    assert metformin[0].timing_summary == (
        "Stable background medication.; Dose increased recently."
    )
    assert "MedicationRequest/medication-dose-change" in context.source_resource_refs


@pytest.mark.anyio
async def test_case_context_keeps_unrelated_medications_separate():
    _, service, ids = await seeded_case_service()

    context = await service.get_case_context(ids["Patient"])

    assert [item.display for item in context.medications] == [
        "Empagliflozin (SGLT2 inhibitor)",
        "Metformin extended-release",
    ]


@pytest.mark.anyio
async def test_seed_refuses_untagged_stable_identifier_collision():
    backend = FhirBackend()
    backend.resources["Patient"]["unrelated"] = {
        "resourceType": "Patient",
        "id": "unrelated",
        "identifier": [
            {
                "system": "https://lamina.health/fhir/demo-patient",
                "value": "lamina-demo-patient-001",
            }
        ],
        "name": [{"text": "Unrelated record"}],
    }
    service = MedplumClientService(settings(), transport=httpx.MockTransport(backend))
    with pytest.raises(MedplumError, match="medplum_stable_identifier_conflict"):
        await service.seed_demo_panel()
    assert backend.resources["Patient"]["unrelated"]["name"] == [
        {"text": "Unrelated record"}
    ]


def test_medplum_generation_reuses_draft_flow_and_hides_identifiers(client):
    http, database = client
    activate(http, DEMO_NPI, DEMO_AGENT_ID, voice=True)
    medplum = FakeMedplumService()
    generation = FakeGenerationService()
    override_services(medplum, generation)
    response = http.post(
        "/medplum/patients/patient-secret-id/forum-posts/generate",
        json={
            "agent_id": DEMO_AGENT_ID,
            "physician_guidance": "Ask for clarifying medication history.",
        },
    )
    assert response.status_code == 200
    post = response.json()
    assert post["status"] == "awaiting_physician_approval"
    assert post["case_classification"] == "synthetic"
    assert post["provenance"]["draft_origin"] == "agent_generated"
    assert http.get("/forum/posts").json()["posts"] == []
    assert http.get(f"/physicians/{DEMO_NPI}/review-inbox").json()["counts"]["posts"] == 1
    sent = json.dumps(generation.medplum_calls[0][1])
    assert "patient-secret-id" not in sent
    assert "condition-secret-id" not in sent
    assert "Alex" not in sent
    link = http.get(f"/forum/posts/{post['id']}/medplum-link").json()
    assert link["medplum_patient_id"] == "patient-secret-id"
    assert link["organization_id"] == "org-lamina-demo-medical-group"
    assert link["medplum_connection_id"] == "medplum-lamina-demo-medical-group"
    with sqlite3.connect(database) as connection:
        assert connection.execute("SELECT COUNT(*) FROM forum_medplum_links").fetchone()[0] == 1


def test_openai_failure_creates_neither_post_nor_link(client):
    http, database = client
    activate(http, DEMO_NPI, DEMO_AGENT_ID, voice=True)
    override_services(FakeMedplumService(), FakeGenerationService(fail=True))
    response = http.post(
        "/medplum/patients/patient-id/forum-posts/generate",
        json={"agent_id": DEMO_AGENT_ID, "physician_guidance": "Synthetic guidance"},
    )
    assert response.status_code == 503
    with sqlite3.connect(database) as connection:
        assert connection.execute("SELECT COUNT(*) FROM forum_posts").fetchone()[0] == 0
        assert connection.execute("SELECT COUNT(*) FROM forum_medplum_links").fetchone()[0] == 0


def test_generation_rejects_patient_outside_physician_practitioner_panel(client):
    http, _ = client
    activate(http, LIANNE_NPI, LIANNE_AGENT_ID, voice=True)

    class PhysicianScopedMedplum(FakeMedplumService):
        async def get_authorized_panel_cases(self, practitioner_id):
            if practitioner_id == "practitioner-ethan":
                return [self.context]
            return []

    medplum = PhysicianScopedMedplum()
    generation = FakeGenerationService()
    override_services(medplum, generation)
    response = http.post(
        "/medplum/patients/patient-secret-id/forum-posts/generate",
        json={
            "agent_id": LIANNE_AGENT_ID,
            "physician_guidance": "Ask a bounded question.",
        },
    )

    assert response.status_code == 403
    assert generation.medplum_calls == []


def test_untagged_patient_is_rejected_safely(client):
    http, _ = client
    override_services(FakeMedplumService(error="medplum_patient_not_synthetic"))
    response = http.get("/medplum/patients/real-patient/case-context")
    assert response.status_code == 403


def test_case_context_read_has_safe_system_audit(client):
    http, database = client
    override_services(FakeMedplumService())
    response = http.get("/medplum/patients/patient-secret-id/case-context")
    assert response.status_code == 200
    with sqlite3.connect(database) as connection:
        event = connection.execute(
            """
            SELECT action, metadata_json FROM integration_audit_events
            WHERE action='medplum_case_context_read'
            """
        ).fetchone()
    assert event[0] == "medplum_case_context_read"
    assert "patient-secret-id" in event[1]
    assert "Persistent nausea" not in event[1]


def test_synthetic_agent_case_discovery_is_bounded_and_identifier_safe(client):
    http, _ = client
    override_services(FakeMedplumService())

    response = http.get(f"/agents/{DEMO_AGENT_ID}/medplum/cases")

    assert response.status_code == 200
    payload = response.json()
    assert payload["agent_id"] == DEMO_AGENT_ID
    assert payload["organization_id"] == "org-lamina-demo-medical-group"
    assert payload["source_system"] == "medplum"
    assert payload["count"] == 2
    assert payload["cases"][0]["synthetic"] is True
    assert "source_resource_refs" not in json.dumps(payload)
    assert "condition-secret-id" not in json.dumps(payload)
    assert http.get("/agents/agent-1234567890/medplum/cases").status_code == 403


def create_generated_post(http):
    response = http.post(
        "/medplum/patients/patient-secret-id/forum-posts/generate",
        json={"agent_id": DEMO_AGENT_ID, "physician_guidance": "Ask clarifying questions"},
    )
    return response.json()


def test_export_requires_approval_and_published_response(client):
    http, _ = client
    activate(http, DEMO_NPI, DEMO_AGENT_ID, voice=True)
    medplum = FakeMedplumService()
    override_services(medplum, FakeGenerationService())
    post = create_generated_post(http)
    assert http.post(f"/forum/posts/{post['id']}/export-to-medplum").status_code == 409
    http.post(f"/forum/posts/{post['id']}/approve", json={"physician_npi": DEMO_NPI})
    assert http.post(f"/forum/posts/{post['id']}/export-to-medplum").status_code == 409


def test_export_contains_only_approved_content_and_is_idempotent(client):
    http, _ = client
    activate(http, DEMO_NPI, DEMO_AGENT_ID, voice=True)
    activate(http, LIANNE_NPI, LIANNE_AGENT_ID, responses=True)
    medplum = FakeMedplumService()
    override_services(medplum, FakeGenerationService())
    post = create_generated_post(http)
    assert http.post(
        f"/forum/posts/{post['id']}/approve", json={"physician_npi": LIANNE_NPI}
    ).status_code == 403
    http.post(f"/forum/posts/{post['id']}/approve", json={"physician_npi": DEMO_NPI})
    approved_response = http.post(
        f"/forum/posts/{post['id']}/responses/drafts",
        json={
            "agent_id": LIANNE_AGENT_ID,
            "response_type": "clarifying_question",
            "headline": "Approved headline",
            "content": "Approved response content",
            "citations": [],
            "draft_origin": "physician_text_request",
        },
    ).json()
    http.post(
        f"/forum/posts/{post['id']}/responses/drafts",
        json={
            "agent_id": LIANNE_AGENT_ID,
            "response_type": "risk",
            "headline": "PRIVATE DRAFT",
            "content": "PRIVATE DRAFT CONTENT",
            "citations": [],
            "draft_origin": "physician_text_request",
        },
    )
    http.post(
        f"/forum/responses/{approved_response['id']}/approve",
        json={"physician_npi": LIANNE_NPI},
    )
    first = http.post(f"/forum/posts/{post['id']}/export-to-medplum")
    second = http.post(f"/forum/posts/{post['id']}/export-to-medplum")
    assert first.status_code == second.status_code == 200
    assert first.json()["communication_id"] == second.json()["communication_id"]
    exported = medplum.exports[-1]
    assert "Synthetic demonstration" in exported["approved_payload"]
    assert "Approved response content" in exported["approved_payload"]
    assert "PRIVATE DRAFT" not in exported["approved_payload"]
    assert exported["patient_id"] == "patient-secret-id"
    link = http.get(f"/forum/posts/{post['id']}/medplum-link").json()
    assert link["export_communication_id"] == "communication-1"


def test_export_rejects_cross_organization_medplum_link(client):
    http, database = client
    activate(http, DEMO_NPI, DEMO_AGENT_ID, voice=True)
    activate(http, LIANNE_NPI, LIANNE_AGENT_ID, responses=True)
    medplum = FakeMedplumService()
    override_services(medplum, FakeGenerationService())
    post = create_generated_post(http)
    http.post(f"/forum/posts/{post['id']}/approve", json={"physician_npi": DEMO_NPI})
    response = http.post(
        f"/forum/posts/{post['id']}/responses/drafts",
        json={
            "agent_id": LIANNE_AGENT_ID,
            "response_type": "clarifying_question",
            "headline": "Approved headline",
            "content": "Approved response content",
            "citations": [],
            "draft_origin": "physician_text_request",
        },
    ).json()
    http.post(
        f"/forum/responses/{response['id']}/approve",
        json={"physician_npi": LIANNE_NPI},
    )
    with sqlite3.connect(database) as connection:
        connection.execute(
            "UPDATE forum_medplum_links SET organization_id='org-another' WHERE post_id=?",
            (post["id"],),
        )

    exported = http.post(f"/forum/posts/{post['id']}/export-to-medplum")

    assert exported.status_code == 409
    assert medplum.exports == []


def test_post_without_medplum_link_cannot_export(client):
    http, _ = client
    with api_main.connect() as connection:
        assert connection.execute("SELECT COUNT(*) FROM forum_medplum_links").fetchone()[0] == 0
    assert http.post("/forum/posts/not-found/export-to-medplum").status_code == 404
