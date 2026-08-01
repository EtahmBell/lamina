from __future__ import annotations

import json
import os
import sqlite3
from datetime import UTC, datetime
from pathlib import Path
from typing import Annotated
from uuid import uuid4

from fastapi import Depends, FastAPI, HTTPException, Query
from fastapi.responses import JSONResponse

from api.medplum import MedplumError, MedplumService, create_medplum_service
from api.models import (
    AgentConfigurationInput,
    AgentMonitoringRunInput,
    ForumPostDraftInput,
    ForumResponseDraftInput,
    GenerateMedplumPostInput,
    GeneratePostInput,
    GenerateResponseInput,
    PhysicianApprovalInput,
    PhysicianRejectionInput,
)
from api.monitoring import (
    MonitoringError,
    MonitoringRuntime,
    MonitoringService,
    create_monitoring_runtime,
)
from api.openai_generation import (
    MEDPLUM_POST_PROMPT_VERSION,
    POST_PROMPT_VERSION,
    RESPONSE_PROMPT_VERSION,
    DraftGenerationService,
    GenerationError,
    GenerationResult,
    create_generation_service,
)
from lamina_directory.common import fts_prefix_query

ROOT = Path(__file__).resolve().parents[1]
DB_PATH = Path(os.getenv("LAMINA_DB_PATH", "data/processed/lamina.sqlite"))
SCHEMA_PATH = ROOT / "sql" / "schema.sql"

class Utf8JSONResponse(JSONResponse):
    media_type = "application/json; charset=utf-8"


app = FastAPI(
    title="Lamina Physician Directory API",
    version="0.2.0",
    default_response_class=Utf8JSONResponse,
)


def utc_now() -> str:
    return datetime.now(UTC).isoformat().replace("+00:00", "Z")


def connect() -> sqlite3.Connection:
    if not DB_PATH.exists():
        raise HTTPException(
            status_code=503,
            detail=f"Directory database not found at {DB_PATH}. Run the ingestion pipeline first.",
        )
    connection = sqlite3.connect(DB_PATH)
    connection.row_factory = sqlite3.Row
    upgrade_forum_post_draft_origin(connection)
    connection.executescript(SCHEMA_PATH.read_text(encoding="utf-8"))
    connection.execute("PRAGMA foreign_keys = ON")
    return connection


def upgrade_forum_post_draft_origin(connection: sqlite3.Connection) -> None:
    definition = connection.execute(
        "SELECT sql FROM sqlite_master WHERE type='table' AND name='forum_posts'"
    ).fetchone()
    if definition is None or "agent_generated" in definition[0]:
        return
    connection.execute("PRAGMA foreign_keys = OFF")
    connection.executescript(
        """
        BEGIN;
        CREATE TABLE forum_posts_new (
          id TEXT PRIMARY KEY,
          author_agent_id TEXT NOT NULL REFERENCES agents(id),
          author_physician_npi TEXT NOT NULL REFERENCES physicians(npi),
          title TEXT NOT NULL,
          clinical_question TEXT NOT NULL,
          context_summary TEXT NOT NULL,
          specialty_tags_json TEXT NOT NULL,
          case_classification TEXT NOT NULL CHECK (case_classification = 'synthetic'),
          status TEXT NOT NULL CHECK (
            status IN (
              'draft', 'awaiting_physician_approval', 'published', 'closed', 'rejected'
            )
          ),
          draft_origin TEXT NOT NULL CHECK (
            draft_origin IN (
              'physician_text_request', 'physician_voice_request', 'agent_suggested',
              'agent_generated'
            )
          ),
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          approved_at TEXT,
          published_at TEXT,
          closed_at TEXT
        );
        INSERT INTO forum_posts_new SELECT * FROM forum_posts;
        DROP TABLE forum_posts;
        ALTER TABLE forum_posts_new RENAME TO forum_posts;
        COMMIT;
        """
    )


def json_list(value: str) -> list[str]:
    return json.loads(value)


def configuration_from_row(row: sqlite3.Row | None) -> dict[str, object] | None:
    if row is None:
        return None
    result = dict(row)
    for stored, public in (
        ("verified_specialties_json", "verified_specialties"),
        ("declared_expertise_tags_json", "declared_expertise_tags"),
        ("monitoring_topics_json", "monitoring_topics"),
        ("report_topics_json", "report_topics"),
        ("notifications_json", "notifications"),
    ):
        result[public] = json_list(result.pop(stored))
    for field in (
        "voice_post_drafting_enabled",
        "response_drafting_enabled",
        "thread_summaries_enabled",
        "citations_required",
    ):
        result[field] = bool(result[field])
    return result


def get_agent_row(connection: sqlite3.Connection, agent_id: str) -> sqlite3.Row:
    row = connection.execute(
        """
        SELECT a.*, p.display_name, p.primary_specialty, p.primary_taxonomy_code,
               p.source, p.profile_status
        FROM agents a JOIN physicians p ON p.npi = a.physician_npi
        WHERE a.id = ?
        """,
        (agent_id,),
    ).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="Agent not found")
    return row


def latest_claim(connection: sqlite3.Connection, agent_id: str) -> sqlite3.Row | None:
    return connection.execute(
        "SELECT * FROM profile_claims WHERE agent_id = ? ORDER BY created_at DESC LIMIT 1",
        (agent_id,),
    ).fetchone()


def get_configuration(connection: sqlite3.Connection, agent_id: str) -> sqlite3.Row | None:
    return connection.execute(
        "SELECT * FROM agent_configurations WHERE agent_id = ?", (agent_id,)
    ).fetchone()


def add_audit(
    connection: sqlite3.Connection,
    agent_id: str,
    physician_npi: str,
    action: str,
    metadata: dict[str, object] | None = None,
) -> None:
    connection.execute(
        """
        INSERT INTO agent_audit_events
          (id, agent_id, physician_npi, actor_type, action, metadata_json, created_at)
        VALUES (?, ?, ?, 'physician', ?, ?, ?)
        """,
        (str(uuid4()), agent_id, physician_npi, action, json.dumps(metadata or {}), utc_now()),
    )


def add_integration_audit(action: str, metadata: dict[str, object] | None = None) -> None:
    with connect() as connection:
        connection.execute(
            """
            INSERT INTO integration_audit_events (id, action, metadata_json, created_at)
            VALUES (?, ?, ?, ?)
            """,
            (str(uuid4()), action, json.dumps(metadata or {}), utc_now()),
        )


def reject_transition(
    connection: sqlite3.Connection, agent: sqlite3.Row, action: str, detail: str
) -> None:
    add_audit(
        connection,
        agent["id"],
        agent["physician_npi"],
        "invalid_transition_attempted",
        {"attempted_action": action, "from_state": agent["status"]},
    )
    connection.commit()
    raise HTTPException(status_code=409, detail=detail)


def readiness(
    agent: sqlite3.Row, claim: sqlite3.Row | None, config: sqlite3.Row | None
) -> dict[str, object]:
    specialties = json_list(config["verified_specialties_json"]) if config else []
    requirements = {
        "claim_verified": claim is not None and claim["status"] == "verified",
        "configuration_saved": config is not None,
        "verified_specialty_present": bool(specialties),
        "publication_requires_approval": (
            config is not None
            and config["publication_mode"] == "requires_physician_approval"
        ),
    }
    return {
        "ready": all(requirements.values()),
        "requirements": requirements,
        "missing": [name for name, satisfied in requirements.items() if not satisfied],
    }


def effective_permissions(
    agent: sqlite3.Row, config: sqlite3.Row | None
) -> dict[str, bool]:
    active = agent["status"] == "active" and config is not None
    return {
        "can_draft_voice_posts": bool(active and config["voice_post_drafting_enabled"]),
        "can_draft_responses": bool(active and config["response_drafting_enabled"]),
        "can_generate_reports": bool(active and config["report_cadence"] != "none"),
        "can_publish_clinical_content": False,
        "requires_physician_approval": True,
    }


def agent_response(connection: sqlite3.Connection, agent_id: str) -> dict[str, object]:
    agent = get_agent_row(connection, agent_id)
    claim = latest_claim(connection, agent_id)
    config = get_configuration(connection, agent_id)
    return {
        "id": agent["id"],
        "physician_npi": agent["physician_npi"],
        "status": agent["status"],
        "physician": {
            "npi": agent["physician_npi"],
            "display_name": agent["display_name"],
            "primary_specialty": agent["primary_specialty"],
            "primary_taxonomy_code": agent["primary_taxonomy_code"],
            "data_source": agent["source"],
            "profile_status": agent["profile_status"],
        },
        "claim": dict(claim) if claim else None,
        "configuration": configuration_from_row(config),
        "effective_permissions": effective_permissions(agent, config),
        "activation_readiness": readiness(agent, claim, config),
    }


def require_draft_permission(
    connection: sqlite3.Connection, agent_id: str, permission: str
) -> sqlite3.Row:
    agent = get_agent_row(connection, agent_id)
    config = get_configuration(connection, agent_id)
    allowed = (
        agent["status"] == "active"
        and config is not None
        and bool(config[permission])
        and config["publication_mode"] == "requires_physician_approval"
    )
    if not allowed:
        reject_transition(
            connection,
            agent,
            "create_forum_draft",
            "Agent lifecycle or configuration does not permit this draft",
        )
    return agent


def require_content_owner(
    connection: sqlite3.Connection,
    agent_id: str,
    physician_npi: str,
    attempted_action: str,
) -> None:
    agent = get_agent_row(connection, agent_id)
    if agent["physician_npi"] != physician_npi:
        add_audit(
            connection,
            agent_id,
            agent["physician_npi"],
            "unauthorized_approval_attempted",
            {"attempted_action": attempted_action, "attempted_by_npi": physician_npi},
        )
        connection.commit()
        raise HTTPException(
            status_code=403,
            detail="A physician may only review content owned by their own agent",
        )


def get_forum_post(connection: sqlite3.Connection, post_id: str) -> sqlite3.Row:
    row = connection.execute("SELECT * FROM forum_posts WHERE id = ?", (post_id,)).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="Forum post not found")
    return row


def get_forum_response(connection: sqlite3.Connection, response_id: str) -> sqlite3.Row:
    row = connection.execute(
        "SELECT * FROM forum_responses WHERE id = ?", (response_id,)
    ).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="Forum response not found")
    return row


def forum_author(connection: sqlite3.Connection, agent_id: str) -> dict[str, object]:
    row = connection.execute(
        """
        SELECT a.id AS agent_id, p.npi, p.display_name, p.primary_specialty,
               p.organization_name
        FROM agents a JOIN physicians p ON p.npi = a.physician_npi
        WHERE a.id = ?
        """,
        (agent_id,),
    ).fetchone()
    return {
        "physician_npi": row["npi"],
        "physician_name": row["display_name"],
        "verified_specialty": row["primary_specialty"],
        "organization": row["organization_name"],
        "agent_id": row["agent_id"],
    }


def forum_response_payload(
    connection: sqlite3.Connection, row: sqlite3.Row
) -> dict[str, object]:
    generation = connection.execute(
        """
        SELECT prompt_version, model, provider_response_id, generated_at
        FROM generation_metadata WHERE content_type='response' AND content_id=?
        """,
        (row["id"],),
    ).fetchone()
    grounding = connection.execute(
        """
        SELECT grounding_mode, source_system, matched_case_count
        FROM response_grounding WHERE response_id=?
        """,
        (row["id"],),
    ).fetchone()
    grounding_payload = (
        {
            "grounding_mode": grounding["grounding_mode"],
            "source_system": grounding["source_system"],
            "matched_case_count": grounding["matched_case_count"],
        }
        if grounding
        else {
            "grounding_mode": "model_only" if generation else None,
            "source_system": "openai" if generation else None,
            "matched_case_count": 0,
        }
    )
    return {
        "id": row["id"],
        "post_id": row["post_id"],
        "response_type": row["response_type"],
        "headline": row["headline"],
        "content": row["content"],
        "citations": json.loads(row["citations_json"]),
        "status": row["status"],
        "author": forum_author(connection, row["author_agent_id"]),
        "provenance": {
            "drafted_by_agent": True,
            "draft_origin": row["draft_origin"],
            "physician_approved": row["approved_at"] is not None,
            "approved_at": row["approved_at"],
            "prompt_version": generation["prompt_version"] if generation else None,
            "model": generation["model"] if generation else None,
            "generated_at": generation["generated_at"] if generation else None,
            "grounding": grounding_payload,
        },
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
        "published_at": row["published_at"],
        "rejected_at": row["rejected_at"],
    }


def forum_post_payload(
    connection: sqlite3.Connection, row: sqlite3.Row
) -> dict[str, object]:
    generation = connection.execute(
        """
        SELECT prompt_version, model, provider_response_id, generated_at
        FROM generation_metadata WHERE content_type='post' AND content_id=?
        """,
        (row["id"],),
    ).fetchone()
    response_rows = connection.execute(
        """
        SELECT * FROM forum_responses
        WHERE post_id = ? AND status = 'published'
        ORDER BY published_at, created_at
        """,
        (row["id"],),
    ).fetchall()
    return {
        "id": row["id"],
        "title": row["title"],
        "clinical_question": row["clinical_question"],
        "context_summary": row["context_summary"],
        "specialty_tags": json.loads(row["specialty_tags_json"]),
        "case_classification": row["case_classification"],
        "status": row["status"],
        "author": forum_author(connection, row["author_agent_id"]),
        "provenance": {
            "drafted_by_agent": True,
            "draft_origin": row["draft_origin"],
            "physician_approved": row["approved_at"] is not None,
            "approved_at": row["approved_at"],
            "prompt_version": generation["prompt_version"] if generation else None,
            "model": generation["model"] if generation else None,
            "generated_at": generation["generated_at"] if generation else None,
        },
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
        "published_at": row["published_at"],
        "closed_at": row["closed_at"],
        "published_response_count": len(response_rows),
        "responses": [forum_response_payload(connection, item) for item in response_rows],
    }


def persist_forum_post_draft(
    connection: sqlite3.Connection,
    agent: sqlite3.Row,
    draft: ForumPostDraftInput,
) -> sqlite3.Row:
    now = utc_now()
    post_id = str(uuid4())
    connection.execute(
        """
        INSERT INTO forum_posts (
          id, author_agent_id, author_physician_npi, title, clinical_question,
          context_summary, specialty_tags_json, case_classification, status,
          draft_origin, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'awaiting_physician_approval', ?, ?, ?)
        """,
        (
            post_id,
            draft.agent_id,
            agent["physician_npi"],
            draft.title,
            draft.clinical_question,
            draft.context_summary,
            json.dumps(draft.specialty_tags),
            draft.case_classification.value,
            draft.draft_origin.value,
            now,
            now,
        ),
    )
    add_audit(
        connection,
        draft.agent_id,
        agent["physician_npi"],
        "post_draft_created",
        {"post_id": post_id},
    )
    return get_forum_post(connection, post_id)


def persist_forum_response_draft(
    connection: sqlite3.Connection,
    post_id: str,
    agent: sqlite3.Row,
    draft: ForumResponseDraftInput,
) -> sqlite3.Row:
    now = utc_now()
    response_id = str(uuid4())
    connection.execute(
        """
        INSERT INTO forum_responses (
          id, post_id, author_agent_id, author_physician_npi, response_type,
          headline, content, citations_json, status, draft_origin, created_at,
          updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'awaiting_physician_approval', ?, ?, ?)
        """,
        (
            response_id,
            post_id,
            draft.agent_id,
            agent["physician_npi"],
            draft.response_type.value,
            draft.headline,
            draft.content,
            json.dumps(draft.citations),
            draft.draft_origin.value,
            now,
            now,
        ),
    )
    add_audit(
        connection,
        draft.agent_id,
        agent["physician_npi"],
        "response_draft_created",
        {"post_id": post_id, "response_id": response_id},
    )
    return get_forum_response(connection, response_id)


def generation_context(
    connection: sqlite3.Connection, agent: sqlite3.Row
) -> dict[str, object]:
    claim = latest_claim(connection, agent["id"])
    config = get_configuration(connection, agent["id"])
    if claim is None or claim["status"] != "verified" or config is None:
        reject_transition(
            connection,
            agent,
            "generate_forum_draft",
            "A verified claim and valid agent configuration are required",
        )
    return {
        "physician_name": agent["display_name"],
        "agent_id": agent["id"],
        "verified_specialties": json.loads(config["verified_specialties_json"]),
        "declared_expertise_tags": json.loads(config["declared_expertise_tags_json"]),
        "monitoring_topics": json.loads(config["monitoring_topics_json"]),
        "citations_required": bool(config["citations_required"]),
        "publication_mode": config["publication_mode"],
    }


def save_generation_metadata(
    connection: sqlite3.Connection,
    *,
    content_type: str,
    content_id: str,
    agent: sqlite3.Row,
    result: GenerationResult,
) -> None:
    connection.execute(
        """
        INSERT INTO generation_metadata (
          id, content_type, content_id, agent_id, physician_npi, prompt_version,
          model, provider_response_id, generated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            str(uuid4()),
            content_type,
            content_id,
            agent["id"],
            agent["physician_npi"],
            result.prompt_version,
            result.model,
            result.provider_response_id,
            utc_now(),
        ),
    )


def audit_generation_failure(
    connection: sqlite3.Connection,
    agent: sqlite3.Row,
    operation: str,
    prompt_version: str,
    category: str,
) -> None:
    add_audit(
        connection,
        agent["id"],
        agent["physician_npi"],
        f"{operation}_generation_failed",
        {"error_category": category, "prompt_version": prompt_version},
    )
    connection.commit()


def translate_generation_error(error: GenerationError) -> HTTPException:
    if error.configuration:
        return HTTPException(
            status_code=503,
            detail="OpenAI generation is not configured on this server",
        )
    return HTTPException(
        status_code=503 if error.category in {"openai_timeout", "openai_rate_limited"} else 502,
        detail="Draft generation is temporarily unavailable",
    )


def get_generation_service() -> DraftGenerationService | None:
    return None


def get_medplum_service() -> MedplumService | None:
    return None


def get_monitoring_runtime() -> MonitoringRuntime | None:
    return None


def translate_medplum_error(error: MedplumError) -> HTTPException:
    if error.configuration:
        return HTTPException(status_code=503, detail="Medplum is not configured on this server")
    if error.not_found:
        return HTTPException(status_code=404, detail="Medplum resource not found")
    if error.category == "medplum_patient_not_synthetic":
        return HTTPException(
            status_code=403, detail="Only explicitly tagged synthetic Medplum patients are supported"
        )
    if error.category == "medplum_authentication_failed":
        return HTTPException(status_code=502, detail="Medplum authentication failed")
    if error.category == "medplum_access_denied":
        return HTTPException(status_code=502, detail="Medplum access was denied")
    if error.category in {"medplum_token_timeout", "medplum_token_unreachable"}:
        return HTTPException(status_code=503, detail="Medplum token endpoint is unreachable")
    if error.category in {"medplum_fhir_timeout", "medplum_fhir_unreachable"}:
        return HTTPException(status_code=503, detail="Medplum FHIR endpoint is unreachable")
    return HTTPException(status_code=503, detail="Medplum is temporarily unavailable")


def translate_monitoring_error(error: MonitoringError) -> HTTPException:
    if error.configuration:
        return HTTPException(status_code=503, detail="Agent monitoring is not configured")
    if error.category == "monitoring_post_not_found":
        return HTTPException(status_code=404, detail="Forum post not found")
    if error.category in {
        "monitoring_post_not_eligible",
        "monitoring_post_not_medplum_grounded",
    }:
        return HTTPException(status_code=409, detail="Forum post is not eligible for monitoring")
    return HTTPException(status_code=503, detail="Grounded monitoring is temporarily unavailable")


def medplum_link_payload(row: sqlite3.Row) -> dict[str, object]:
    return {
        "post_id": row["post_id"],
        "medplum_patient_id": row["medplum_patient_id"],
        "source_type": row["source_type"],
        "condition_ids": json.loads(row["medplum_condition_ids_json"]),
        "medication_request_ids": json.loads(row["medplum_medication_request_ids_json"]),
        "observation_ids": json.loads(row["medplum_observation_ids_json"]),
        "created_by_agent_id": row["created_by_agent_id"],
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
        "export_communication_id": row["export_communication_id"],
        "exported_at": row["exported_at"],
    }


def approved_discussion_payload(
    connection: sqlite3.Connection, post: sqlite3.Row, responses: list[sqlite3.Row]
) -> str:
    post_author = forum_author(connection, post["author_agent_id"])
    lines = [
        "Synthetic demonstration - approved Lamina physician-network discussion.",
        f"Lamina forum post ID: {post['id']}",
        f"Approved question title: {post['title']}",
        f"Approved clinical question: {post['clinical_question']}",
        f"Approved context summary: {post['context_summary']}",
        (
            f"Question author: {post_author['physician_name']} "
            f"({post_author['verified_specialty']})"
        ),
        f"Post physician approval timestamp: {post['approved_at']}",
        "Published responses:",
    ]
    for response in responses:
        author = forum_author(connection, response["author_agent_id"])
        lines.extend(
            [
                f"- {response['headline']}",
                f"  Approved response: {response['content']}",
                f"  Responding physician: {author['physician_name']} ({author['verified_specialty']})",
                f"  Physician approval timestamp: {response['approved_at']}",
            ]
        )
    lines.append("Only physician-approved Lamina content is included.")
    lines.append("This Communication is not a diagnosis, treatment order, or clinical decision.")
    return "\n".join(lines)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "database": str(DB_PATH)}


@app.get("/physicians/search")
def search_physicians(
    q: Annotated[str, Query(min_length=2, max_length=120)],
    state: Annotated[str | None, Query(min_length=2, max_length=2)] = None,
    limit: Annotated[int, Query(ge=1, le=50)] = 10,
) -> dict[str, object]:
    fts_query = fts_prefix_query(q)
    if not fts_query:
        return {"results": [], "count": 0}
    sql = """
      SELECT p.*, a.id AS agent_id, a.status AS agent_status, a.claimed,
             a.public_posting_enabled,
             bm25(physician_fts, 8.0, 3.0, 1.0, 0.5) AS rank
      FROM physician_fts JOIN physicians p ON p.npi = physician_fts.npi
      JOIN agents a ON a.physician_npi = p.npi WHERE physician_fts MATCH ?
    """
    params: list[object] = [fts_query]
    if state:
        sql += " AND p.state = ?"
        params.append(state.upper())
    sql += " ORDER BY rank, p.last_name, p.first_name LIMIT ?"
    params.append(limit)
    with connect() as connection:
        rows = [dict(row) for row in connection.execute(sql, params).fetchall()]
    return {"results": rows, "count": len(rows)}


@app.get("/physicians/{npi}")
def get_physician(npi: str) -> dict[str, object]:
    with connect() as connection:
        row = connection.execute(
            """
            SELECT p.*, a.id AS agent_id, a.status AS agent_status, a.claimed,
                   a.public_posting_enabled
            FROM physicians p JOIN agents a ON a.physician_npi = p.npi
            WHERE p.npi = ?
            """,
            (npi,),
        ).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="Physician not found")
    return dict(row)


@app.post("/physicians/{npi}/claims")
def request_claim(npi: str) -> dict[str, object]:
    with connect() as connection:
        agent = connection.execute(
            "SELECT * FROM agents WHERE physician_npi = ?", (npi,)
        ).fetchone()
        if agent is None:
            raise HTTPException(status_code=404, detail="Physician not found")
        claim = latest_claim(connection, agent["id"])
        if claim is not None and claim["status"] in {"pending", "verified"}:
            return {"claim": dict(claim), "agent_status": agent["status"]}
        if agent["status"] != "reserved":
            reject_transition(connection, agent, "request_claim", "Agent is not reservable")
        now = utc_now()
        claim_id = str(uuid4())
        connection.execute(
            """
            INSERT INTO profile_claims
              (id, physician_npi, agent_id, status, requested_at, created_at, updated_at)
            VALUES (?, ?, ?, 'pending', ?, ?, ?)
            """,
            (claim_id, npi, agent["id"], now, now, now),
        )
        connection.execute("UPDATE agents SET status = 'claim_pending' WHERE id = ?", (agent["id"],))
        connection.execute(
            "UPDATE physicians SET profile_status = 'pending' WHERE npi = ?", (npi,)
        )
        add_audit(connection, agent["id"], npi, "claim_requested")
        claim = connection.execute("SELECT * FROM profile_claims WHERE id = ?", (claim_id,)).fetchone()
        return {"claim": dict(claim), "agent_status": "claim_pending"}


@app.post("/claims/{claim_id}/verify-demo")
def verify_demo_claim(claim_id: str) -> dict[str, object]:
    with connect() as connection:
        claim = connection.execute(
            """
            SELECT c.*, p.source, a.status AS agent_status
            FROM profile_claims c JOIN physicians p ON p.npi = c.physician_npi
            JOIN agents a ON a.id = c.agent_id WHERE c.id = ?
            """,
            (claim_id,),
        ).fetchone()
        if claim is None:
            raise HTTPException(status_code=404, detail="Claim not found")
        if claim["source"].casefold() != "synthetic":
            add_audit(
                connection, claim["agent_id"], claim["physician_npi"],
                "claim_demo_verification_rejected", {"reason": "non_synthetic_profile"},
            )
            connection.commit()
            raise HTTPException(
                status_code=403,
                detail="Demo verification is restricted to explicitly synthetic physicians; NPPES directory profiles require production verification.",
            )
        if claim["status"] == "verified":
            stored_claim = connection.execute(
                "SELECT * FROM profile_claims WHERE id = ?", (claim_id,)
            ).fetchone()
            return {"claim": dict(stored_claim), "agent_status": "verified"}
        if claim["status"] != "pending" or claim["agent_status"] != "claim_pending":
            agent = get_agent_row(connection, claim["agent_id"])
            reject_transition(connection, agent, "verify_demo", "Claim is not pending verification")
        now = utc_now()
        connection.execute(
            "UPDATE profile_claims SET status='verified', verification_method='demo', verified_at=?, updated_at=? WHERE id=?",
            (now, now, claim_id),
        )
        connection.execute(
            "UPDATE agents SET status='verified', claimed=1 WHERE id=?", (claim["agent_id"],)
        )
        connection.execute(
            "UPDATE physicians SET profile_status='verified' WHERE npi=?", (claim["physician_npi"],)
        )
        add_audit(connection, claim["agent_id"], claim["physician_npi"], "claim_demo_verified")
        verified = connection.execute("SELECT * FROM profile_claims WHERE id=?", (claim_id,)).fetchone()
        return {"claim": dict(verified), "agent_status": "verified"}


@app.get("/agents/{agent_id}")
def get_agent(agent_id: str) -> dict[str, object]:
    with connect() as connection:
        return agent_response(connection, agent_id)


@app.put("/agents/{agent_id}/configuration")
def save_configuration(
    agent_id: str, configuration: AgentConfigurationInput
) -> dict[str, object]:
    with connect() as connection:
        agent = get_agent_row(connection, agent_id)
        claim = latest_claim(connection, agent_id)
        if claim is None or claim["status"] != "verified":
            reject_transition(
                connection, agent, "save_configuration", "A verified physician claim is required"
            )
        if agent["status"] not in {"verified", "configuring", "active", "paused"}:
            reject_transition(
                connection, agent, "save_configuration", "Agent cannot be configured in its current state"
            )
        existing = get_configuration(connection, agent_id)
        now = utc_now()
        specialties = [agent["primary_specialty"]] if agent["primary_specialty"] else []
        values = (
            agent_id,
            json.dumps(specialties),
            json.dumps(configuration.declared_expertise_tags),
            json.dumps(configuration.monitoring_topics),
            int(configuration.voice_post_drafting_enabled),
            int(configuration.response_drafting_enabled),
            int(configuration.thread_summaries_enabled),
            int(configuration.citations_required),
            configuration.publication_mode.value,
            configuration.report_cadence.value,
            json.dumps(configuration.report_topics),
            configuration.report_source_scope.value,
            configuration.report_length.value,
            json.dumps([value.value for value in configuration.notifications]),
            now,
            now,
        )
        connection.execute(
            """
            INSERT INTO agent_configurations (
              agent_id, verified_specialties_json, declared_expertise_tags_json,
              monitoring_topics_json, voice_post_drafting_enabled,
              response_drafting_enabled, thread_summaries_enabled, citations_required,
              publication_mode, report_cadence, report_topics_json, report_source_scope,
              report_length, notifications_json, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(agent_id) DO UPDATE SET
              verified_specialties_json=excluded.verified_specialties_json,
              declared_expertise_tags_json=excluded.declared_expertise_tags_json,
              monitoring_topics_json=excluded.monitoring_topics_json,
              voice_post_drafting_enabled=excluded.voice_post_drafting_enabled,
              response_drafting_enabled=excluded.response_drafting_enabled,
              thread_summaries_enabled=excluded.thread_summaries_enabled,
              citations_required=excluded.citations_required,
              publication_mode=excluded.publication_mode,
              report_cadence=excluded.report_cadence,
              report_topics_json=excluded.report_topics_json,
              report_source_scope=excluded.report_source_scope,
              report_length=excluded.report_length,
              notifications_json=excluded.notifications_json,
              updated_at=excluded.updated_at
            """,
            values,
        )
        if agent["status"] == "verified":
            connection.execute("UPDATE agents SET status='configuring' WHERE id=?", (agent_id,))
        add_audit(
            connection, agent_id, agent["physician_npi"],
            "configuration_updated" if existing else "configuration_created",
        )
        return agent_response(connection, agent_id)


@app.post("/agents/{agent_id}/activate")
def activate_agent(agent_id: str) -> dict[str, object]:
    with connect() as connection:
        agent = get_agent_row(connection, agent_id)
        if agent["status"] == "active":
            return agent_response(connection, agent_id)
        claim = latest_claim(connection, agent_id)
        config = get_configuration(connection, agent_id)
        state = readiness(agent, claim, config)
        if agent["status"] not in {"configuring", "paused"} or not state["ready"]:
            reject_transition(
                connection, agent, "activate", f"Activation requirements missing: {state['missing']}"
            )
        connection.execute("UPDATE agents SET status='active' WHERE id=?", (agent_id,))
        add_audit(connection, agent_id, agent["physician_npi"], "agent_activated")
        return agent_response(connection, agent_id)


@app.post("/agents/{agent_id}/pause")
def pause_agent(agent_id: str) -> dict[str, object]:
    with connect() as connection:
        agent = get_agent_row(connection, agent_id)
        if agent["status"] == "paused":
            return agent_response(connection, agent_id)
        if agent["status"] != "active":
            reject_transition(connection, agent, "pause", "Only an active agent may be paused")
        connection.execute("UPDATE agents SET status='paused' WHERE id=?", (agent_id,))
        add_audit(connection, agent_id, agent["physician_npi"], "agent_paused")
        return agent_response(connection, agent_id)


@app.get("/agents/{agent_id}/activation-readiness")
def activation_readiness(agent_id: str) -> dict[str, object]:
    with connect() as connection:
        agent = get_agent_row(connection, agent_id)
        return readiness(agent, latest_claim(connection, agent_id), get_configuration(connection, agent_id))


@app.post("/forum/posts/drafts")
def create_forum_post_draft(draft: ForumPostDraftInput) -> dict[str, object]:
    with connect() as connection:
        agent = require_draft_permission(
            connection, draft.agent_id, "voice_post_drafting_enabled"
        )
        post = persist_forum_post_draft(connection, agent, draft)
        return forum_post_payload(connection, post)


@app.post("/forum/posts/drafts/generate")
async def generate_forum_post_draft(
    request: GeneratePostInput,
    injected_service: Annotated[
        DraftGenerationService | None, Depends(get_generation_service)
    ],
) -> dict[str, object]:
    with connect() as connection:
        agent = require_draft_permission(
            connection, request.agent_id, "voice_post_drafting_enabled"
        )
        context = generation_context(connection, agent)
        try:
            service = injected_service or create_generation_service()
            result = await service.generate_post(context, request.raw_request)
        except GenerationError as error:
            audit_generation_failure(
                connection, agent, "post", POST_PROMPT_VERSION, error.category
            )
            raise translate_generation_error(error) from error

        draft = ForumPostDraftInput(
            agent_id=agent["id"],
            title=result.output.title,
            clinical_question=result.output.clinical_question,
            context_summary=result.output.context_summary,
            specialty_tags=result.output.specialty_tags,
            case_classification="synthetic",
            draft_origin="agent_generated",
        )
        post = persist_forum_post_draft(connection, agent, draft)
        save_generation_metadata(
            connection,
            content_type="post",
            content_id=post["id"],
            agent=agent,
            result=result,
        )
        add_audit(
            connection,
            agent["id"],
            agent["physician_npi"],
            "post_generation_succeeded",
            {
                "post_id": post["id"],
                "model": result.model,
                "prompt_version": result.prompt_version,
                "provider_response_id": result.provider_response_id,
            },
        )
        return forum_post_payload(connection, post)


@app.get("/forum/posts")
def list_forum_posts(
    specialty: str | None = None,
    status: str = "published",
    author_physician_npi: str | None = None,
    limit: Annotated[int, Query(ge=1, le=100)] = 20,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> dict[str, object]:
    if status not in {"published", "closed"}:
        raise HTTPException(status_code=403, detail="Unpublished drafts are not public")
    sql = "SELECT * FROM forum_posts WHERE status = ?"
    params: list[object] = [status]
    if author_physician_npi:
        sql += " AND author_physician_npi = ?"
        params.append(author_physician_npi)
    if specialty:
        sql += " AND EXISTS (SELECT 1 FROM json_each(specialty_tags_json) WHERE value = ?)"
        params.append(specialty)
    sql += " ORDER BY published_at DESC, created_at DESC LIMIT ? OFFSET ?"
    params.extend((limit, offset))
    with connect() as connection:
        rows = connection.execute(sql, params).fetchall()
        return {
            "posts": [forum_post_payload(connection, row) for row in rows],
            "count": len(rows),
            "limit": limit,
            "offset": offset,
        }


@app.get("/forum/posts/{post_id}")
def get_forum_post_thread(
    post_id: str, viewer_physician_npi: str | None = None
) -> dict[str, object]:
    with connect() as connection:
        post = get_forum_post(connection, post_id)
        if post["status"] not in {"published", "closed"}:
            owner = connection.execute(
                "SELECT source FROM physicians WHERE npi = ?",
                (post["author_physician_npi"],),
            ).fetchone()
            if (
                viewer_physician_npi != post["author_physician_npi"]
                or owner["source"].casefold() != "synthetic"
            ):
                raise HTTPException(status_code=404, detail="Forum post not found")
        return forum_post_payload(connection, post)


@app.post("/forum/posts/{post_id}/approve")
def approve_forum_post(
    post_id: str, approval: PhysicianApprovalInput
) -> dict[str, object]:
    with connect() as connection:
        post = get_forum_post(connection, post_id)
        require_content_owner(
            connection,
            post["author_agent_id"],
            approval.physician_npi,
            "approve_post",
        )
        if post["status"] == "published":
            return forum_post_payload(connection, post)
        if post["status"] != "awaiting_physician_approval":
            raise HTTPException(status_code=409, detail="Post is not awaiting approval")
        now = utc_now()
        connection.execute(
            """
            UPDATE forum_posts
            SET status='published', approved_at=?, published_at=?, updated_at=?
            WHERE id=?
            """,
            (now, now, now, post_id),
        )
        add_audit(
            connection,
            post["author_agent_id"],
            post["author_physician_npi"],
            "post_approved",
            {"post_id": post_id},
        )
        return forum_post_payload(connection, get_forum_post(connection, post_id))


@app.post("/forum/posts/{post_id}/reject")
def reject_forum_post(
    post_id: str, rejection: PhysicianRejectionInput
) -> dict[str, object]:
    with connect() as connection:
        post = get_forum_post(connection, post_id)
        require_content_owner(
            connection,
            post["author_agent_id"],
            rejection.physician_npi,
            "reject_post",
        )
        if post["status"] == "rejected":
            return forum_post_payload(connection, post)
        if post["status"] != "awaiting_physician_approval":
            raise HTTPException(status_code=409, detail="Post is not awaiting review")
        now = utc_now()
        connection.execute(
            "UPDATE forum_posts SET status='rejected', updated_at=? WHERE id=?",
            (now, post_id),
        )
        add_audit(
            connection,
            post["author_agent_id"],
            post["author_physician_npi"],
            "post_rejected",
            {"post_id": post_id},
        )
        return forum_post_payload(connection, get_forum_post(connection, post_id))


@app.post("/forum/posts/{post_id}/responses/drafts")
def create_forum_response_draft(
    post_id: str, draft: ForumResponseDraftInput
) -> dict[str, object]:
    with connect() as connection:
        post = get_forum_post(connection, post_id)
        if post["status"] != "published":
            raise HTTPException(status_code=409, detail="Responses require a published post")
        agent = require_draft_permission(
            connection, draft.agent_id, "response_drafting_enabled"
        )
        response = persist_forum_response_draft(connection, post_id, agent, draft)
        return forum_response_payload(connection, response)


@app.post("/forum/posts/{post_id}/responses/generate")
async def generate_forum_response_draft(
    post_id: str,
    request: GenerateResponseInput,
    injected_service: Annotated[
        DraftGenerationService | None, Depends(get_generation_service)
    ],
) -> dict[str, object]:
    with connect() as connection:
        post = get_forum_post(connection, post_id)
        if post["status"] != "published":
            raise HTTPException(status_code=409, detail="Responses require a published post")
        if post["case_classification"] != "synthetic":
            raise HTTPException(status_code=409, detail="Only synthetic cases are supported")
        agent = require_draft_permission(
            connection, request.agent_id, "response_drafting_enabled"
        )
        context = generation_context(connection, agent)
        published_responses = connection.execute(
            """
            SELECT response_type, headline, content
            FROM forum_responses
            WHERE post_id=? AND status='published'
            ORDER BY published_at DESC LIMIT 10
            """,
            (post_id,),
        ).fetchall()
        thread = {
            "title": post["title"],
            "clinical_question": post["clinical_question"],
            "context_summary": post["context_summary"],
            "specialty_tags": json.loads(post["specialty_tags_json"]),
            "case_classification": post["case_classification"],
            "published_responses": [
                {
                    "response_type": row["response_type"],
                    "headline": row["headline"],
                    "content": row["content"][:2_000],
                }
                for row in published_responses
            ],
        }
        try:
            service = injected_service or create_generation_service()
            result = await service.generate_response(
                context, thread, request.physician_guidance
            )
        except GenerationError as error:
            audit_generation_failure(
                connection, agent, "response", RESPONSE_PROMPT_VERSION, error.category
            )
            raise translate_generation_error(error) from error

        draft = ForumResponseDraftInput(
            agent_id=agent["id"],
            response_type=result.output.response_type,
            headline=result.output.headline,
            content=result.output.content,
            citations=[],
            draft_origin="agent_generated",
        )
        response = persist_forum_response_draft(connection, post_id, agent, draft)
        save_generation_metadata(
            connection,
            content_type="response",
            content_id=response["id"],
            agent=agent,
            result=result,
        )
        add_audit(
            connection,
            agent["id"],
            agent["physician_npi"],
            "response_generation_succeeded",
            {
                "post_id": post_id,
                "response_id": response["id"],
                "model": result.model,
                "prompt_version": result.prompt_version,
                "provider_response_id": result.provider_response_id,
            },
        )
        return forum_response_payload(connection, response)


@app.post("/forum/responses/{response_id}/approve")
def approve_forum_response(
    response_id: str, approval: PhysicianApprovalInput
) -> dict[str, object]:
    with connect() as connection:
        response = get_forum_response(connection, response_id)
        require_content_owner(
            connection,
            response["author_agent_id"],
            approval.physician_npi,
            "approve_response",
        )
        if response["status"] == "published":
            return forum_response_payload(connection, response)
        if response["status"] != "awaiting_physician_approval":
            raise HTTPException(status_code=409, detail="Response is not awaiting approval")
        now = utc_now()
        connection.execute(
            """
            UPDATE forum_responses
            SET status='published', approved_at=?, published_at=?, updated_at=?
            WHERE id=?
            """,
            (now, now, now, response_id),
        )
        add_audit(
            connection,
            response["author_agent_id"],
            response["author_physician_npi"],
            "response_approved",
            {"post_id": response["post_id"], "response_id": response_id},
        )
        return forum_response_payload(connection, get_forum_response(connection, response_id))


@app.post("/forum/responses/{response_id}/reject")
def reject_forum_response(
    response_id: str, rejection: PhysicianRejectionInput
) -> dict[str, object]:
    with connect() as connection:
        response = get_forum_response(connection, response_id)
        require_content_owner(
            connection,
            response["author_agent_id"],
            rejection.physician_npi,
            "reject_response",
        )
        if response["status"] == "rejected":
            return forum_response_payload(connection, response)
        if response["status"] != "awaiting_physician_approval":
            raise HTTPException(status_code=409, detail="Response is not awaiting review")
        now = utc_now()
        connection.execute(
            """
            UPDATE forum_responses
            SET status='rejected', rejected_at=?, updated_at=? WHERE id=?
            """,
            (now, now, response_id),
        )
        add_audit(
            connection,
            response["author_agent_id"],
            response["author_physician_npi"],
            "response_rejected",
            {"post_id": response["post_id"], "response_id": response_id},
        )
        return forum_response_payload(connection, get_forum_response(connection, response_id))


@app.get("/physicians/{npi}/review-inbox")
def physician_review_inbox(npi: str) -> dict[str, object]:
    with connect() as connection:
        physician = connection.execute(
            "SELECT source FROM physicians WHERE npi = ?", (npi,)
        ).fetchone()
        if physician is None:
            raise HTTPException(status_code=404, detail="Physician not found")
        if physician["source"].casefold() != "synthetic":
            raise HTTPException(
                status_code=403, detail="Review inbox is limited to synthetic demo physicians"
            )
        posts = connection.execute(
            """
            SELECT * FROM forum_posts
            WHERE author_physician_npi=? AND status='awaiting_physician_approval'
            ORDER BY created_at
            """,
            (npi,),
        ).fetchall()
        responses = connection.execute(
            """
            SELECT * FROM forum_responses
            WHERE author_physician_npi=? AND status='awaiting_physician_approval'
            ORDER BY created_at
            """,
            (npi,),
        ).fetchall()
        return {
            "physician_npi": npi,
            "counts": {"posts": len(posts), "responses": len(responses)},
            "post_drafts": [forum_post_payload(connection, row) for row in posts],
            "response_drafts": [
                forum_response_payload(connection, row) for row in responses
            ],
        }


@app.get("/forum/responses/{response_id}/grounding-review")
def get_response_grounding_review(
    response_id: str, physician_npi: str
) -> dict[str, object]:
    with connect() as connection:
        response = get_forum_response(connection, response_id)
        require_content_owner(
            connection,
            response["author_agent_id"],
            physician_npi,
            "review_response_grounding",
        )
        grounding = connection.execute(
            "SELECT * FROM response_grounding WHERE response_id=?", (response_id,)
        ).fetchone()
        if grounding is None:
            raise HTTPException(status_code=404, detail="Grounding review not found")
        return {
            "response": forum_response_payload(connection, response),
            "grounding": {
                "grounding_mode": grounding["grounding_mode"],
                "source_system": grounding["source_system"],
                "matched_case_count": grounding["matched_case_count"],
                "relevance_reason": grounding["relevance_reason"],
                "similarities": json.loads(grounding["similarities_json"]),
                "differences": json.loads(grounding["differences_json"]),
                "unknowns": json.loads(grounding["unknowns_json"]),
                "supporting_case_summaries": json.loads(
                    grounding["supporting_case_summaries_json"]
                ),
                "execution_trace": json.loads(grounding["execution_trace_json"]),
            },
        }


@app.post("/forum/posts/{post_id}/monitor")
async def monitor_forum_post(
    post_id: str,
    injected_medplum: Annotated[MedplumService | None, Depends(get_medplum_service)],
    injected_runtime: Annotated[MonitoringRuntime | None, Depends(get_monitoring_runtime)],
) -> dict[str, object]:
    try:
        medplum = injected_medplum or create_medplum_service()
        runtime = injected_runtime or create_monitoring_runtime()
        return await MonitoringService(connect, medplum, runtime).evaluate_post(post_id)
    except MedplumError as error:
        raise translate_medplum_error(error) from error
    except MonitoringError as error:
        raise translate_monitoring_error(error) from error


@app.post("/agents/{agent_id}/monitoring/run")
async def monitor_forum_post_for_agent(
    agent_id: str,
    request: AgentMonitoringRunInput,
    injected_medplum: Annotated[MedplumService | None, Depends(get_medplum_service)],
    injected_runtime: Annotated[MonitoringRuntime | None, Depends(get_monitoring_runtime)],
) -> dict[str, object]:
    try:
        medplum = injected_medplum or create_medplum_service()
        runtime = injected_runtime or create_monitoring_runtime()
        return await MonitoringService(connect, medplum, runtime).evaluate_post(
            request.post_id, only_agent_id=agent_id
        )
    except MedplumError as error:
        raise translate_medplum_error(error) from error
    except MonitoringError as error:
        raise translate_monitoring_error(error) from error


@app.get("/integrations/medplum/health")
async def medplum_health(
    injected_service: Annotated[MedplumService | None, Depends(get_medplum_service)],
) -> dict[str, object]:
    try:
        service = injected_service or create_medplum_service()
        result = await service.health()
        add_integration_audit("medplum_health_check_succeeded")
        return result
    except MedplumError as error:
        add_integration_audit(
            "medplum_health_check_failed", {"error_category": error.category}
        )
        if error.configuration:
            return {
                "configured": False,
                "authenticated": False,
                "fhir_reachable": False,
                "project_id_configured": False,
                "error": "medplum_not_configured",
            }
        raise translate_medplum_error(error) from error


@app.get("/medplum/patients/{patient_id}/case-context")
async def get_medplum_case_context(
    patient_id: str,
    injected_service: Annotated[MedplumService | None, Depends(get_medplum_service)],
) -> dict[str, object]:
    try:
        service = injected_service or create_medplum_service()
        context = await service.get_case_context(patient_id)
    except MedplumError as error:
        add_integration_audit(
            "medplum_case_context_read_failed",
            {"medplum_patient_id": patient_id, "error_category": error.category},
        )
        raise translate_medplum_error(error) from error
    add_integration_audit(
        "medplum_case_context_read",
        {
            "medplum_patient_id": patient_id,
            "resource_types": ["Condition", "MedicationRequest", "Observation"],
        },
    )
    return context.model_dump()


@app.post("/medplum/patients/{patient_id}/forum-posts/generate")
async def generate_forum_post_from_medplum(
    patient_id: str,
    request: GenerateMedplumPostInput,
    injected_medplum: Annotated[MedplumService | None, Depends(get_medplum_service)],
    injected_generation: Annotated[
        DraftGenerationService | None, Depends(get_generation_service)
    ],
) -> dict[str, object]:
    try:
        medplum = injected_medplum or create_medplum_service()
        case_context = await medplum.get_case_context(patient_id)
    except MedplumError as error:
        raise translate_medplum_error(error) from error

    with connect() as connection:
        agent = require_draft_permission(
            connection, request.agent_id, "voice_post_drafting_enabled"
        )
        agent_context = generation_context(connection, agent)
        case_facts = {
            "synthetic": True,
            "age_band": case_context.age_band,
            "conditions": [item.model_dump() for item in case_context.conditions],
            "medications": [item.model_dump() for item in case_context.medications],
            "observations": [item.model_dump() for item in case_context.observations],
        }
        try:
            generator = injected_generation or create_generation_service()
            result = await generator.generate_medplum_post(
                agent_context, case_facts, request.physician_guidance
            )
        except GenerationError as error:
            add_audit(
                connection,
                agent["id"],
                agent["physician_npi"],
                "medplum_post_generation_failed",
                {
                    "error_category": error.category,
                    "prompt_version": MEDPLUM_POST_PROMPT_VERSION,
                    "medplum_patient_id": patient_id,
                },
            )
            connection.commit()
            raise translate_generation_error(error) from error

        draft = ForumPostDraftInput(
            agent_id=agent["id"],
            title=result.output.title,
            clinical_question=result.output.clinical_question,
            context_summary=result.output.context_summary,
            specialty_tags=result.output.specialty_tags,
            case_classification="synthetic",
            draft_origin="agent_generated",
        )
        post = persist_forum_post_draft(connection, agent, draft)
        save_generation_metadata(
            connection,
            content_type="post",
            content_id=post["id"],
            agent=agent,
            result=result,
        )
        by_type = {
            resource_type: [
                reference.split("/", 1)[1]
                for reference in case_context.source_resource_refs
                if reference.startswith(f"{resource_type}/")
            ]
            for resource_type in ("Condition", "MedicationRequest", "Observation")
        }
        now = utc_now()
        link_id = str(uuid4())
        connection.execute(
            """
            INSERT INTO forum_medplum_links (
              id, post_id, medplum_patient_id, medplum_condition_ids_json,
              medplum_medication_request_ids_json, medplum_observation_ids_json,
              source_type, created_by_agent_id, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, 'medplum_synthetic_patient', ?, ?, ?)
            """,
            (
                link_id,
                post["id"],
                patient_id,
                json.dumps(by_type["Condition"]),
                json.dumps(by_type["MedicationRequest"]),
                json.dumps(by_type["Observation"]),
                agent["id"],
                now,
                now,
            ),
        )
        add_audit(
            connection,
            agent["id"],
            agent["physician_npi"],
            "medplum_post_generation_succeeded",
            {
                "post_id": post["id"],
                "medplum_patient_id": patient_id,
                "prompt_version": result.prompt_version,
                "resource_types": ["Condition", "MedicationRequest", "Observation"],
            },
        )
        link = connection.execute(
            "SELECT * FROM forum_medplum_links WHERE id=?", (link_id,)
        ).fetchone()
        payload = forum_post_payload(connection, post)
        payload["medplum_link"] = medplum_link_payload(link)
        return payload


@app.get("/forum/posts/{post_id}/medplum-link")
def get_forum_post_medplum_link(post_id: str) -> dict[str, object]:
    with connect() as connection:
        get_forum_post(connection, post_id)
        link = connection.execute(
            "SELECT * FROM forum_medplum_links WHERE post_id=?", (post_id,)
        ).fetchone()
        if link is None:
            raise HTTPException(status_code=404, detail="Medplum link not found")
        return medplum_link_payload(link)


@app.post("/forum/posts/{post_id}/export-to-medplum")
async def export_forum_post_to_medplum(
    post_id: str,
    injected_service: Annotated[MedplumService | None, Depends(get_medplum_service)],
) -> dict[str, object]:
    with connect() as connection:
        post = get_forum_post(connection, post_id)
        link = connection.execute(
            "SELECT * FROM forum_medplum_links WHERE post_id=?", (post_id,)
        ).fetchone()
        if link is None:
            raise HTTPException(status_code=409, detail="Forum post has no Medplum provenance link")
        if post["status"] != "published" or not post["approved_at"]:
            raise HTTPException(status_code=409, detail="Only approved published posts may be exported")
        responses = connection.execute(
            """
            SELECT * FROM forum_responses
            WHERE post_id=? AND status='published' AND approved_at IS NOT NULL
            ORDER BY published_at, created_at
            """,
            (post_id,),
        ).fetchall()
        if not responses:
            raise HTTPException(
                status_code=409,
                detail="At least one physician-approved published response is required",
            )
        source_refs = [
            f"Condition/{value}"
            for value in json.loads(link["medplum_condition_ids_json"])
        ] + [
            f"MedicationRequest/{value}"
            for value in json.loads(link["medplum_medication_request_ids_json"])
        ] + [
            f"Observation/{value}"
            for value in json.loads(link["medplum_observation_ids_json"])
        ]
        approved_payload = approved_discussion_payload(connection, post, responses)
        try:
            medplum = injected_service or create_medplum_service()
            exported = await medplum.export_discussion(
                post_id=post_id,
                patient_id=link["medplum_patient_id"],
                source_refs=source_refs,
                title=post["title"],
                approved_payload=approved_payload,
            )
        except MedplumError as error:
            add_audit(
                connection,
                post["author_agent_id"],
                post["author_physician_npi"],
                "medplum_export_failed",
                {"post_id": post_id, "error_category": error.category},
            )
            connection.commit()
            raise translate_medplum_error(error) from error
        now = utc_now()
        connection.execute(
            """
            UPDATE forum_medplum_links
            SET export_communication_id=?, exported_at=?, updated_at=? WHERE post_id=?
            """,
            (exported["communication_id"], now, now, post_id),
        )
        add_audit(
            connection,
            post["author_agent_id"],
            post["author_physician_npi"],
            "medplum_export_succeeded",
            {
                "post_id": post_id,
                "medplum_patient_id": link["medplum_patient_id"],
                "communication_id": exported["communication_id"],
            },
        )
        return {
            "post_id": post_id,
            "medplum_patient_id": link["medplum_patient_id"],
            "communication_id": exported["communication_id"],
            "status": exported["status"],
            "exported_at": now,
        }
