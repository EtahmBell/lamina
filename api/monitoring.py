from __future__ import annotations

import asyncio
import hashlib
import json
import os
import re
import sqlite3
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Protocol
from uuid import uuid4

from agents import (
    Agent,
    AgentsException,
    ModelSettings,
    RunConfig,
    RunContextWrapper,
    Runner,
    ToolExecutionConfig,
    function_tool,
)
from pydantic import ValidationError

from api.medplum import MedplumError, MedplumService
from api.models import (
    GroundedMonitoringResult,
    MedplumCaseContext,
    MonitoringAction,
)

MONITORING_PROMPT_VERSION = "lamina-monitoring-agent-v2"
MAX_CANDIDATES = 5
MAX_RETRIEVED_CASES = 3
MAX_AGENT_TURNS = 8
FHIR_REFERENCE_PATTERN = re.compile(
    r"\b(?:Patient|Condition|Observation|MedicationRequest|Practitioner)/[A-Za-z0-9.-]+",
    re.IGNORECASE,
)
MODEL_FORBIDDEN_KEYS = frozenset(
    {
        "id",
        "patient_id",
        "condition_id",
        "condition_ids",
        "observation_id",
        "observation_ids",
        "medication_request_id",
        "medication_request_ids",
        "source_resource_refs",
    }
)


class MonitoringError(Exception):
    def __init__(self, category: str, *, configuration: bool = False) -> None:
        super().__init__(category)
        self.category = category
        self.configuration = configuration


@dataclass(frozen=True)
class MonitoringSettings:
    model: str
    timeout_seconds: float
    tracing_enabled: bool

    @classmethod
    def from_environment(cls) -> MonitoringSettings:
        model = os.getenv("LAMINA_AGENT_MODEL", "").strip() or os.getenv(
            "OPENAI_MODEL", ""
        ).strip()
        if not model or not os.getenv("OPENAI_API_KEY", "").strip():
            raise MonitoringError("monitoring_not_configured", configuration=True)
        try:
            timeout = float(os.getenv("LAMINA_AGENT_REQUEST_TIMEOUT_SECONDS", "60"))
        except ValueError as error:
            raise MonitoringError("monitoring_configuration_invalid", configuration=True) from error
        if timeout <= 0:
            raise MonitoringError("monitoring_configuration_invalid", configuration=True)
        tracing = os.getenv("LAMINA_AGENT_TRACING_ENABLED", "false").casefold() in {
            "1",
            "true",
            "yes",
        }
        return cls(model=model, timeout_seconds=timeout, tracing_enabled=tracing)


def utc_now() -> str:
    return datetime.now(UTC).isoformat().replace("+00:00", "Z")


def assert_model_safe_payload(payload: object) -> None:
    def inspect(value: object) -> None:
        if isinstance(value, dict):
            for key, nested in value.items():
                normalized_key = key.casefold().removeprefix("medplum_")
                if normalized_key in MODEL_FORBIDDEN_KEYS:
                    raise MonitoringError("monitoring_model_payload_identifier_detected")
                inspect(nested)
        elif isinstance(value, (list, tuple, set)):
            for nested in value:
                inspect(nested)
        elif isinstance(value, str) and FHIR_REFERENCE_PATTERN.search(value):
            raise MonitoringError("monitoring_model_payload_identifier_detected")

    inspect(payload)


def safe_case_summary(context: MedplumCaseContext) -> dict[str, object]:
    summary = {
        "synthetic": True,
        "age_band": context.age_band,
        "conditions": [item.model_dump() for item in context.conditions[:10]],
        "medications": [item.model_dump() for item in context.medications[:10]],
        "observations": [item.model_dump() for item in context.observations[:10]],
    }
    assert_model_safe_payload(summary)
    return summary


def _terms(values: list[str]) -> set[str]:
    joined = " ".join(values).casefold()
    aliases = {
        "sglt2": ("sglt2", "empagliflozin", "dapagliflozin", "canagliflozin"),
        "nausea": ("nausea",),
        "abdominal": ("abdominal",),
        "fatigue": ("fatigue",),
        "low_bicarbonate": ("bicarbonate", "low"),
        "high_anion_gap": ("anion gap", "elevated"),
        "elevated_ketone": ("beta-hydroxybutyrate", "elevated"),
        "modest_glucose": ("not dramatically elevated",),
        "normal_bicarbonate": ("bicarbonate", "normal"),
        "normal_anion_gap": ("anion gap", "normal"),
    }
    return {
        name for name, needles in aliases.items() if all(needle in joined for needle in needles)
    }


def case_features(context: MedplumCaseContext) -> dict[str, set[str]]:
    conditions = {item.display.casefold() for item in context.conditions}
    medications = _terms(
        [f"{item.display} {item.timing_summary}" for item in context.medications]
    )
    observations = _terms(
        [f"{item.display} {item.value_summary}" for item in context.observations]
    )
    return {
        "conditions": conditions,
        "medications": medications & {"sglt2"},
        "symptoms": observations & {"nausea", "abdominal", "fatigue"},
        "labs": observations
        & {
            "low_bicarbonate",
            "high_anion_gap",
            "elevated_ketone",
            "modest_glucose",
            "normal_bicarbonate",
            "normal_anion_gap",
        },
    }


def _overlap(left: set[str], right: set[str]) -> float:
    return len(left & right) / max(len(left), 1)


def case_similarity_score(
    source: MedplumCaseContext, candidate: MedplumCaseContext
) -> tuple[float, list[str]]:
    left = case_features(source)
    right = case_features(candidate)
    components = {
        "condition overlap": 0.25 * _overlap(left["conditions"], right["conditions"]),
        "medication-class overlap": 0.25
        * _overlap(left["medications"], right["medications"]),
        "symptom overlap": 0.20 * _overlap(left["symptoms"], right["symptoms"]),
        "laboratory-pattern overlap": 0.25 * _overlap(left["labs"], right["labs"]),
        "age-band compatibility": 0.05 if source.age_band == candidate.age_band else 0.0,
    }
    score = round(sum(components.values()) * 100, 1)
    reasons = [name for name, value in components.items() if value > 0]
    return score, reasons


@dataclass
class MonitoringRunContext:
    # Agents SDK run context is local dependency state, not model input. Only the
    # explicitly projected and validated tool return values cross that boundary.
    monitoring_run_id: str
    agent_id: str
    physician_npi: str
    physician_display_name: str
    verified_specialties: list[str]
    monitoring_topics: list[str]
    permitted_medplum_practitioner_id: str
    current_post_id: str
    post_context: dict[str, object]
    source_case_context: MedplumCaseContext
    medplum: MedplumService
    candidate_case_refs: dict[str, MedplumCaseContext] = field(default_factory=dict)
    candidate_metadata: dict[str, dict[str, object]] = field(default_factory=dict)
    retrieved_case_refs: set[str] = field(default_factory=set)
    execution_trace: list[str] = field(default_factory=lambda: ["post_loaded"])

    async def search_cases(self, limit: int) -> list[dict[str, object]]:
        contexts = await self.medplum.get_authorized_panel_cases(
            self.permitted_medplum_practitioner_id
        )
        ranked: list[tuple[float, MedplumCaseContext, list[str]]] = []
        for context in contexts:
            score, reasons = case_similarity_score(self.source_case_context, context)
            if score > 0:
                ranked.append((score, context, reasons))
        ranked.sort(key=lambda item: (-item[0], item[1].age_band))
        results: list[dict[str, object]] = []
        for score, context, reasons in ranked[: min(max(limit, 1), MAX_CANDIDATES)]:
            digest = hashlib.sha256(
                f"{self.monitoring_run_id}:{self.agent_id}:{context.patient_id}".encode()
            ).hexdigest()[:16]
            case_ref = f"case-{digest}"
            self.candidate_case_refs[case_ref] = context
            metadata = {
                "case_ref": case_ref,
                "case_similarity_score": score,
                "why_matched": reasons,
                "high_level_facts": {
                    "age_band": context.age_band,
                    "conditions": [item.display for item in context.conditions[:5]],
                    "medications": [item.display for item in context.medications[:5]],
                    "observations": [item.display for item in context.observations[:8]],
                },
            }
            self.candidate_metadata[case_ref] = metadata
            results.append(metadata)
        self.execution_trace.extend(
            ["deterministic_candidate_match", "medplum_panel_searched"]
        )
        self.execution_trace.append(f"case_candidates_found:{len(results)}")
        assert_model_safe_payload(results)
        return results

    async def get_case_summary(self, case_ref: str) -> dict[str, object]:
        if case_ref not in self.candidate_case_refs:
            raise MonitoringError("monitoring_case_ref_not_authorized")
        if case_ref not in self.retrieved_case_refs and len(self.retrieved_case_refs) >= 3:
            raise MonitoringError("monitoring_case_retrieval_limit")
        self.retrieved_case_refs.add(case_ref)
        self.execution_trace.append(f"bounded_case_retrieved:{case_ref}")
        summary = {
            "case_ref": case_ref,
            **safe_case_summary(self.candidate_case_refs[case_ref]),
        }
        assert_model_safe_payload(summary)
        return summary


@function_tool(timeout=20)
async def get_published_post_context(
    context: RunContextWrapper[MonitoringRunContext],
) -> dict[str, object]:
    """Load the current approved synthetic Lamina post and bounded source-case features."""
    assert_model_safe_payload(context.context.post_context)
    return context.context.post_context


@function_tool(timeout=30)
async def search_my_similar_cases(
    context: RunContextWrapper[MonitoringRunContext],
    comparison_features: list[str],
    limit: int = 5,
) -> list[dict[str, object]]:
    """Search only the current physician agent's authorized synthetic Medplum panel."""
    del comparison_features
    return await context.context.search_cases(limit)


@function_tool(timeout=20)
async def get_my_case_summary(
    context: RunContextWrapper[MonitoringRunContext], case_ref: str
) -> dict[str, object]:
    """Retrieve one bounded case previously returned by this run's authorized search."""
    return await context.context.get_case_summary(case_ref)


def monitoring_instructions(context: MonitoringRunContext) -> str:
    return f"""Prompt version: {MONITORING_PROMPT_VERSION}
You are a physician-supervised Lamina monitoring agent drafting for
{context.physician_display_name}. You are not that physician.

Your task is not to answer from general model knowledge. Use the supplied tools to determine
whether the physician's authorized synthetic Medplum patient experience contains a useful similar
case. Load the post, search the authorized panel, and retrieve bounded summaries for every case you
intend to cite as support.

Never invent patient facts, identifiers, outcomes, citations, diagnoses, treatment instructions,
or source cases. Distinguish similarities, differences, and unknowns. Do not turn correlation into
causation. General knowledge may organize terminology but is not evidence. If grounding is absent
or insufficient, return no_response. Never publish. Any draft requires physician review and
approval. matching_case_refs may contain only refs returned and retrieved through tools in this
run. Workflow state belongs only in application metadata: never put review or approval labels in
the response headline or content. Do not narrate empty citation metadata. grounding_summary.source
must be medplum."""


class MonitoringRuntime(Protocol):
    model: str

    async def run(self, context: MonitoringRunContext) -> GroundedMonitoringResult: ...


class AgentsMonitoringRuntime:
    def __init__(self, settings: MonitoringSettings) -> None:
        self.settings = settings
        self.model = settings.model

    async def run(self, context: MonitoringRunContext) -> GroundedMonitoringResult:
        instructions = monitoring_instructions(context)
        model_input = "Evaluate the current published synthetic post using authorized tools. Draft only when retrieved prior synthetic case facts are genuinely useful."
        assert_model_safe_payload(
            {"instructions": instructions, "model_input": model_input}
        )
        assert_model_safe_payload(context.post_context)
        agent = Agent[MonitoringRunContext](
            name="Lamina physician-owned monitoring agent",
            instructions=instructions,
            model=self.model,
            model_settings=ModelSettings(parallel_tool_calls=False, store=False),
            tools=[
                get_published_post_context,
                search_my_similar_cases,
                get_my_case_summary,
            ],
            output_type=GroundedMonitoringResult,
        )
        try:
            run = Runner.run(
                agent,
                model_input,
                context=context,
                max_turns=MAX_AGENT_TURNS,
                run_config=RunConfig(
                    tracing_disabled=not self.settings.tracing_enabled,
                    trace_include_sensitive_data=False,
                    workflow_name="Lamina grounded physician monitoring",
                    tool_execution=ToolExecutionConfig(max_function_tool_concurrency=1),
                ),
            )
            result = await asyncio.wait_for(run, timeout=self.settings.timeout_seconds)
        except TimeoutError as error:
            raise MonitoringError("monitoring_agent_timeout") from error
        except AgentsException as error:
            raise MonitoringError("monitoring_agent_failed") from error
        try:
            return GroundedMonitoringResult.model_validate(result.final_output)
        except ValidationError as error:
            raise MonitoringError("monitoring_invalid_output") from error


def deterministic_route(
    post: sqlite3.Row, config: sqlite3.Row
) -> tuple[bool, list[str], str]:
    post_text = " ".join(
        [
            post["title"],
            post["clinical_question"],
            post["context_summary"],
            *json.loads(post["specialty_tags_json"]),
        ]
    ).casefold()
    routing_terms = [
        *json.loads(config["verified_specialties_json"]),
        *json.loads(config["declared_expertise_tags_json"]),
        *json.loads(config["monitoring_topics_json"]),
    ]
    matched = []
    for term in routing_terms:
        words = [word for word in term.casefold().split() if len(word) >= 5]
        if term.casefold() in post_text or any(word in post_text for word in words):
            matched.append(term)
    medication_signal = any(
        word in post_text for word in ("medication", "diabetes", "metabolic", "sglt2")
    ) and any(
        word in " ".join(routing_terms).casefold()
        for word in ("medication", "diabetes", "metabolic", "endocrin")
    )
    if medication_signal:
        matched.append("synthetic medication/metabolic routing signal")
    matched = list(dict.fromkeys(matched))
    return bool(matched), matched, (
        "Routing metadata overlaps the published synthetic case"
        if matched
        else "No routing metadata overlap"
    )


class MonitoringService:
    def __init__(
        self,
        connect: Callable[[], sqlite3.Connection],
        medplum: MedplumService,
        runtime: MonitoringRuntime,
    ) -> None:
        self.connect = connect
        self.medplum = medplum
        self.runtime = runtime

    @staticmethod
    def _audit(
        connection: sqlite3.Connection,
        agent: sqlite3.Row,
        action: str,
        metadata: dict[str, object],
    ) -> None:
        connection.execute(
            """
            INSERT INTO agent_audit_events
              (id, agent_id, physician_npi, actor_type, action, metadata_json, created_at)
            VALUES (?, ?, ?, 'agent_runtime', ?, ?, ?)
            """,
            (
                str(uuid4()),
                agent["id"],
                agent["physician_npi"],
                action,
                json.dumps(metadata),
                utc_now(),
            ),
        )

    async def evaluate_post(
        self, post_id: str, *, only_agent_id: str | None = None
    ) -> dict[str, object]:
        with self.connect() as connection:
            post = connection.execute(
                "SELECT * FROM forum_posts WHERE id=?", (post_id,)
            ).fetchone()
            if post is None:
                raise MonitoringError("monitoring_post_not_found")
            if post["status"] != "published" or post["case_classification"] != "synthetic":
                raise MonitoringError("monitoring_post_not_eligible")
            link = connection.execute(
                "SELECT * FROM forum_medplum_links WHERE post_id=?", (post_id,)
            ).fetchone()
            if link is None:
                raise MonitoringError("monitoring_post_not_medplum_grounded")
            source_context = await self.medplum.get_case_context(link["medplum_patient_id"])
            params: list[object] = [post["author_agent_id"]]
            where = "a.id != ?"
            if only_agent_id:
                where += " AND a.id=?"
                params.append(only_agent_id)
            agents = connection.execute(
                f"""
                SELECT a.*, p.display_name, p.source, ac.*, mpl.medplum_practitioner_id
                FROM agents a
                JOIN physicians p ON p.npi=a.physician_npi
                JOIN agent_configurations ac ON ac.agent_id=a.id
                JOIN medplum_practitioner_links mpl ON mpl.agent_id=a.id
                WHERE {where} AND a.status='active' AND lower(p.source)='synthetic'
                  AND ac.response_drafting_enabled=1
                  AND ac.publication_mode='requires_physician_approval'
                ORDER BY a.id
                """,
                params,
            ).fetchall()
            results = [
                await self._evaluate_agent(connection, post, source_context, agent)
                for agent in agents
            ]
            return {
                "post_id": post_id,
                "agents_evaluated": len(results),
                "results": results,
            }

    async def _evaluate_agent(
        self,
        connection: sqlite3.Connection,
        post: sqlite3.Row,
        source_context: MedplumCaseContext,
        agent: sqlite3.Row,
    ) -> dict[str, object]:
        existing = connection.execute(
            """
            SELECT mr.*, fr.status AS response_status FROM monitoring_runs mr
            LEFT JOIN forum_responses fr ON fr.id=mr.response_id
            WHERE mr.post_id=? AND mr.agent_id=?
            """,
            (post["id"], agent["id"]),
        ).fetchone()
        if existing and existing["outcome"] == "draft_created" and existing["response_status"] in {
            "awaiting_physician_approval",
            "published",
        }:
            return self._run_payload(agent, existing)

        candidate, matched, _reason = deterministic_route(post, agent)
        run_id = existing["id"] if existing else str(uuid4())
        started = utc_now()
        connection.execute(
            """
            INSERT INTO monitoring_runs (
              id, post_id, agent_id, status, routing_candidate, matched_topics_json,
              prompt_version, model, safe_trace_json, started_at
            ) VALUES (?, ?, ?, 'running', ?, ?, ?, ?, ?, ?)
            ON CONFLICT(post_id, agent_id) DO UPDATE SET
              status='running', routing_candidate=excluded.routing_candidate,
              matched_topics_json=excluded.matched_topics_json, outcome=NULL,
              matched_case_count=0, response_id=NULL, safe_trace_json=excluded.safe_trace_json,
              started_at=excluded.started_at, completed_at=NULL, safe_error_category=NULL
            """,
            (
                run_id,
                post["id"],
                agent["id"],
                int(candidate),
                json.dumps(matched),
                MONITORING_PROMPT_VERSION,
                self.runtime.model,
                json.dumps(["monitoring_started"]),
                started,
            ),
        )
        self._audit(connection, agent, "monitoring_started", {"monitoring_run_id": run_id, "post_id": post["id"]})
        if not candidate:
            self._finish(connection, run_id, "skipped", 0, ["monitoring_started", "routing_skipped"])
            return self._run_payload(
                agent,
                connection.execute("SELECT * FROM monitoring_runs WHERE id=?", (run_id,)).fetchone(),
            )
        self._audit(connection, agent, "monitoring_candidate_matched", {"monitoring_run_id": run_id, "post_id": post["id"], "matched_topics": matched})
        post_context = {
            "title": post["title"],
            "clinical_question": post["clinical_question"],
            "approved_context_summary": post["context_summary"],
            "specialty_tags": json.loads(post["specialty_tags_json"]),
            "synthetic": True,
            "bounded_source_case": safe_case_summary(source_context),
        }
        run_context = MonitoringRunContext(
            monitoring_run_id=run_id,
            agent_id=agent["id"],
            physician_npi=agent["physician_npi"],
            physician_display_name=agent["display_name"],
            verified_specialties=json.loads(agent["verified_specialties_json"]),
            monitoring_topics=json.loads(agent["monitoring_topics_json"]),
            permitted_medplum_practitioner_id=agent["medplum_practitioner_id"],
            current_post_id=post["id"],
            post_context=post_context,
            source_case_context=source_context,
            medplum=self.medplum,
        )
        try:
            result = await self.runtime.run(run_context)
            self._validate_result(result, run_context)
            self._audit(connection, agent, "monitoring_panel_search_completed", {"monitoring_run_id": run_id, "matched_case_count": len(run_context.candidate_case_refs)})
            for case_ref in sorted(run_context.retrieved_case_refs):
                self._audit(connection, agent, "monitoring_case_retrieved", {"monitoring_run_id": run_id, "case_ref": case_ref})
            if result.action == MonitoringAction.NO_RESPONSE:
                self._finish(connection, run_id, "no_relevant_case", 0, run_context.execution_trace)
                self._audit(connection, agent, "monitoring_no_relevant_case", {"monitoring_run_id": run_id, "post_id": post["id"]})
            else:
                run_context.execution_trace.append("response_draft_created")
                response_id = self._persist_response(
                    connection, post, agent, run_id, result, run_context
                )
                self._finish(
                    connection,
                    run_id,
                    "draft_created",
                    len(result.matching_case_refs),
                    run_context.execution_trace,
                    response_id=response_id,
                )
                self._audit(connection, agent, "monitoring_response_drafted", {"monitoring_run_id": run_id, "post_id": post["id"], "response_id": response_id, "matched_case_count": len(result.matching_case_refs)})
        except (MonitoringError, MedplumError) as error:
            category = error.category
            self._finish(connection, run_id, "failed", 0, run_context.execution_trace, error=category)
            self._audit(connection, agent, "monitoring_failed", {"monitoring_run_id": run_id, "post_id": post["id"], "safe_error_category": category})
        row = connection.execute("SELECT * FROM monitoring_runs WHERE id=?", (run_id,)).fetchone()
        return self._run_payload(agent, row)

    @staticmethod
    def _validate_result(
        result: GroundedMonitoringResult, context: MonitoringRunContext
    ) -> None:
        refs = set(result.matching_case_refs)
        if result.grounding_summary.source != "medplum":
            raise MonitoringError("monitoring_invalid_grounding_source")
        if not refs <= context.retrieved_case_refs:
            raise MonitoringError("monitoring_unsupported_case_ref")
        if result.grounding_summary.matched_case_count != len(refs):
            raise MonitoringError("monitoring_case_count_mismatch")
        if result.action == MonitoringAction.NO_RESPONSE:
            if result.response_draft is not None:
                raise MonitoringError("monitoring_invalid_abstention")
            return
        if result.response_draft is None or not refs or not result.relevance.is_relevant:
            raise MonitoringError("monitoring_grounding_required")
        supporting_text = json.dumps(
            [safe_case_summary(context.candidate_case_refs[ref]) for ref in refs]
        ).casefold()
        content = result.response_draft.content.casefold()
        for claim_term in ("improved", "recovered", "discontinued", "stopped"):
            if claim_term in content and claim_term not in supporting_text:
                raise MonitoringError("monitoring_unsupported_outcome_claim")

    def _persist_response(
        self,
        connection: sqlite3.Connection,
        post: sqlite3.Row,
        agent: sqlite3.Row,
        run_id: str,
        result: GroundedMonitoringResult,
        context: MonitoringRunContext,
    ) -> str:
        assert_model_safe_payload(context.execution_trace)
        response_id = str(uuid4())
        now = utc_now()
        draft = result.response_draft
        connection.execute(
            """
            INSERT INTO forum_responses (
              id, post_id, author_agent_id, author_physician_npi, response_type,
              headline, content, citations_json, status, draft_origin, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, '[]', 'awaiting_physician_approval',
                      'agent_generated', ?, ?)
            """,
            (
                response_id,
                post["id"],
                agent["id"],
                agent["physician_npi"],
                draft.response_type.value,
                draft.headline,
                draft.content,
                now,
                now,
            ),
        )
        connection.execute(
            """
            INSERT INTO generation_metadata (
              id, content_type, content_id, agent_id, physician_npi, prompt_version,
              model, generated_at
            ) VALUES (?, 'response', ?, ?, ?, ?, ?, ?)
            """,
            (str(uuid4()), response_id, agent["id"], agent["physician_npi"], MONITORING_PROMPT_VERSION, self.runtime.model, now),
        )
        summaries = [
            {"case_ref": ref, **safe_case_summary(context.candidate_case_refs[ref])}
            for ref in result.matching_case_refs
        ]
        connection.execute(
            """
            INSERT INTO response_grounding (
              response_id, grounding_mode, source_system, matched_case_count,
              supporting_case_refs_json, monitoring_run_id, relevance_reason,
              similarities_json, differences_json, unknowns_json,
              supporting_case_summaries_json, execution_trace_json, created_at
            ) VALUES (?, 'medplum_case_match', 'medplum', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                response_id,
                len(result.matching_case_refs),
                json.dumps(result.matching_case_refs),
                run_id,
                result.relevance.concise_reason,
                json.dumps(result.similarities),
                json.dumps(result.differences),
                json.dumps(result.unknowns),
                json.dumps(summaries),
                json.dumps(context.execution_trace),
                now,
            ),
        )
        return response_id

    @staticmethod
    def _finish(
        connection: sqlite3.Connection,
        run_id: str,
        outcome: str,
        count: int,
        trace: list[str],
        *,
        response_id: str | None = None,
        error: str | None = None,
    ) -> None:
        assert_model_safe_payload(trace)
        connection.execute(
            """
            UPDATE monitoring_runs SET status=?, outcome=?, matched_case_count=?,
              response_id=?, safe_trace_json=?, completed_at=?, safe_error_category=?
            WHERE id=?
            """,
            (
                "failed" if outcome == "failed" else "completed",
                outcome,
                count,
                response_id,
                json.dumps(trace),
                utc_now(),
                error,
                run_id,
            ),
        )

    @staticmethod
    def _run_payload(agent: sqlite3.Row, row: sqlite3.Row) -> dict[str, object]:
        return {
            "agent_id": agent["id"],
            "physician_name": agent["display_name"],
            "candidate": bool(row["routing_candidate"]),
            "monitoring_run_id": row["id"],
            "outcome": row["outcome"],
            "matched_case_count": row["matched_case_count"],
            "response_id": row["response_id"],
            "safe_error_category": row["safe_error_category"],
        }


def create_monitoring_runtime() -> MonitoringRuntime:
    return AgentsMonitoringRuntime(MonitoringSettings.from_environment())
