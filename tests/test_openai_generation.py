from __future__ import annotations

import sqlite3
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

import api.main as api_main
from api.models import (
    GeneratedPostDraft,
    GeneratedResponseDraft,
    MonitoringResponseDraft,
)
from api.openai_generation import (
    POST_PROMPT_VERSION,
    RESPONSE_PROMPT_VERSION,
    GenerationError,
    GenerationResult,
    physician_agent_instructions,
)
from lamina_directory.seed_demo_physician import (
    DEMO_AGENT_ID,
    DEMO_NPI,
    LIANNE_AGENT_ID,
    LIANNE_NPI,
    seed_demo_physician,
)

DRAFT_STATE_PHRASES = (
    "for physician review",
    "awaiting approval",
    "not physician approved",
    "not a physician opinion until approved",
    "no citations were supplied",
)


def assert_no_draft_state_phrases(*values: str) -> None:
    clinical_text = " ".join(values).casefold()
    for phrase in DRAFT_STATE_PHRASES:
        assert phrase not in clinical_text


class FakeGenerationService:
    def __init__(self, *, error: str | None = None) -> None:
        self.error = error
        self.post_calls: list[tuple[dict[str, object], str]] = []
        self.response_calls: list[
            tuple[dict[str, object], dict[str, object], str | None]
        ] = []

    async def generate_post(self, context, raw_request):
        self.post_calls.append((context, raw_request))
        if self.error:
            raise GenerationError(self.error)
        return GenerationResult(
            output=GeneratedPostDraft(
                title="Persistent nausea after medication change",
                clinical_question="What considerations may help clarify the timing?",
                context_summary="Synthetic adult aged 40–49 with no identifying information.",
                specialty_tags=["Internal Medicine", " internal medicine ", "Endocrinology"],
                uncertainties=["Medication history is incomplete."],
            ),
            model="fake-model",
            prompt_version=POST_PROMPT_VERSION,
            provider_response_id="resp_post_fake",
        )

    async def generate_response(self, context, thread, physician_guidance):
        self.response_calls.append((context, thread, physician_guidance))
        if self.error:
            raise GenerationError(self.error)
        return GenerationResult(
            output=GeneratedResponseDraft(
                response_type="clarifying_question",
                headline="Clarify timing and concurrent changes",
                content="Clarify whether symptoms recur after each dose.",
                citations=["Invented citation that must not persist"],
                uncertainties=["Medication history is incomplete."],
            ),
            model="fake-model",
            prompt_version=RESPONSE_PROMPT_VERSION,
            provider_response_id="resp_response_fake",
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
    monkeypatch.setattr(api_main, "DB_PATH", database)
    api_main.app.dependency_overrides.clear()
    yield TestClient(api_main.app), database
    api_main.app.dependency_overrides.clear()


def activate(
    client: TestClient,
    npi: str,
    agent_id: str,
    *,
    voice: bool = False,
    responses: bool = False,
) -> None:
    claim = client.post(f"/physicians/{npi}/claims").json()["claim"]
    assert client.post(f"/claims/{claim['id']}/verify-demo").status_code == 200
    configured = client.put(
        f"/agents/{agent_id}/configuration",
        json={
            "voice_post_drafting_enabled": voice,
            "response_drafting_enabled": responses,
        },
    )
    assert configured.status_code == 200
    assert client.post(f"/agents/{agent_id}/activate").status_code == 200


def use_fake(fake: FakeGenerationService) -> None:
    api_main.app.dependency_overrides[api_main.get_generation_service] = lambda: fake


def generate_post(client: TestClient):
    return client.post(
        "/forum/posts/drafts/generate",
        json={
            "agent_id": DEMO_AGENT_ID,
            "raw_request": "Create a question about a clearly synthetic medication case.",
        },
    )


def publish_manual_post(client: TestClient) -> str:
    draft = client.post(
        "/forum/posts/drafts",
        json={
            "agent_id": DEMO_AGENT_ID,
            "title": "Synthetic medication timing question",
            "clinical_question": "What timing details should be clarified?",
            "context_summary": "Synthetic adult case without identifying information.",
            "specialty_tags": ["Internal Medicine"],
            "case_classification": "synthetic",
            "draft_origin": "physician_text_request",
        },
    ).json()
    client.post(
        f"/forum/posts/{draft['id']}/approve", json={"physician_npi": DEMO_NPI}
    )
    return draft["id"]


def test_application_and_non_ai_routes_work_without_openai_configuration(
    client, monkeypatch: pytest.MonkeyPatch
) -> None:
    http, _ = client
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    monkeypatch.delenv("OPENAI_MODEL", raising=False)
    assert http.get("/health").status_code == 200
    assert http.get(f"/agents/{DEMO_AGENT_ID}").status_code == 200
    activate(http, DEMO_NPI, DEMO_AGENT_ID, voice=True)
    response = generate_post(http)
    assert response.status_code == 503
    assert "key" not in response.text.casefold()
    assert "openai" in response.json()["detail"].casefold()


def test_generated_post_uses_existing_review_and_publication_workflow(client) -> None:
    http, database = client
    activate(http, DEMO_NPI, DEMO_AGENT_ID, voice=True)
    fake = FakeGenerationService()
    use_fake(fake)

    generated = generate_post(http)
    assert generated.status_code == 200
    assert generated.headers["content-type"] == "application/json; charset=utf-8"
    assert "40–49".encode() in generated.content
    post = generated.json()
    assert post["status"] == "awaiting_physician_approval"
    assert post["case_classification"] == "synthetic"
    assert post["author"]["physician_npi"] == DEMO_NPI
    assert post["provenance"] == {
        "drafted_by_agent": True,
        "draft_origin": "agent_generated",
        "physician_approved": False,
        "approved_at": None,
        "prompt_version": POST_PROMPT_VERSION,
        "model": "fake-model",
        "generated_at": post["provenance"]["generated_at"],
    }
    assert post["specialty_tags"] == ["Internal Medicine", "Endocrinology"]
    assert post["context_summary"] == (
        "Synthetic adult aged 40–49 with no identifying information."
    )
    assert_no_draft_state_phrases(
        post["title"], post["clinical_question"], post["context_summary"]
    )
    assert http.get("/forum/posts").json()["posts"] == []
    inbox = http.get(f"/physicians/{DEMO_NPI}/review-inbox").json()
    assert [item["id"] for item in inbox["post_drafts"]] == [post["id"]]
    assert http.post(
        f"/forum/posts/{post['id']}/approve", json={"physician_npi": LIANNE_NPI}
    ).status_code == 403
    approved = http.post(
        f"/forum/posts/{post['id']}/approve", json={"physician_npi": DEMO_NPI}
    )
    assert approved.status_code == 200
    assert approved.json()["context_summary"] == post["context_summary"]
    assert [item["id"] for item in http.get("/forum/posts").json()["posts"]] == [
        post["id"]
    ]
    assert fake.post_calls[0][0]["agent_id"] == DEMO_AGENT_ID
    with sqlite3.connect(database) as connection:
        stored_summary = connection.execute(
            "SELECT context_summary FROM forum_posts WHERE id=?", (post["id"],)
        ).fetchone()[0]
        actions = {
            row[0] for row in connection.execute("SELECT action FROM agent_audit_events")
        }
    assert stored_summary == "Synthetic adult aged 40–49 with no identifying information."
    assert "post_generation_succeeded" in actions


@pytest.mark.parametrize("state", ["reserved", "paused", "drafting_disabled", "unverified"])
def test_agent_permission_states_cannot_generate_post(client, state: str) -> None:
    http, database = client
    if state == "paused":
        activate(http, DEMO_NPI, DEMO_AGENT_ID, voice=True)
        http.post(f"/agents/{DEMO_AGENT_ID}/pause")
    elif state == "drafting_disabled":
        activate(http, DEMO_NPI, DEMO_AGENT_ID, voice=False)
    elif state == "unverified":
        with sqlite3.connect(database) as connection:
            connection.execute("UPDATE agents SET status='active' WHERE id=?", (DEMO_AGENT_ID,))
    use_fake(FakeGenerationService())
    assert generate_post(http).status_code == 409


def test_generated_response_is_private_owned_and_citation_safe(client) -> None:
    http, _ = client
    activate(http, DEMO_NPI, DEMO_AGENT_ID, voice=True)
    activate(http, LIANNE_NPI, LIANNE_AGENT_ID, responses=True)
    post_id = publish_manual_post(http)
    fake = FakeGenerationService()
    use_fake(fake)
    generated = http.post(
        f"/forum/posts/{post_id}/responses/generate",
        json={
            "agent_id": LIANNE_AGENT_ID,
            "physician_guidance": "Ask clarifying questions and do not diagnose.",
        },
    )
    assert generated.status_code == 200
    response = generated.json()
    assert response["status"] == "awaiting_physician_approval"
    assert response["provenance"]["draft_origin"] == "agent_generated"
    assert response["citations"] == []
    assert_no_draft_state_phrases(response["headline"], response["content"])
    assert http.get(f"/forum/posts/{post_id}").json()["responses"] == []
    inbox = http.get(f"/physicians/{LIANNE_NPI}/review-inbox").json()
    assert [item["id"] for item in inbox["response_drafts"]] == [response["id"]]
    assert http.post(
        f"/forum/responses/{response['id']}/approve", json={"physician_npi": DEMO_NPI}
    ).status_code == 403
    assert http.post(
        f"/forum/responses/{response['id']}/approve", json={"physician_npi": LIANNE_NPI}
    ).status_code == 200
    assert http.get(f"/forum/posts/{post_id}").json()["published_response_count"] == 1
    assert fake.response_calls[0][1]["case_classification"] == "synthetic"


@pytest.mark.parametrize("post_status", ["awaiting_physician_approval", "rejected"])
def test_response_generation_requires_published_post(client, post_status: str) -> None:
    http, database = client
    activate(http, DEMO_NPI, DEMO_AGENT_ID, voice=True)
    activate(http, LIANNE_NPI, LIANNE_AGENT_ID, responses=True)
    post = http.post(
        "/forum/posts/drafts",
        json={
            "agent_id": DEMO_AGENT_ID,
            "title": "Synthetic question",
            "clinical_question": "What should be clarified?",
            "context_summary": "Synthetic context only.",
            "specialty_tags": [],
            "case_classification": "synthetic",
            "draft_origin": "physician_text_request",
        },
    ).json()
    if post_status == "rejected":
        with sqlite3.connect(database) as connection:
            connection.execute(
                "UPDATE forum_posts SET status='rejected' WHERE id=?", (post["id"],)
            )
    use_fake(FakeGenerationService())
    result = http.post(
        f"/forum/posts/{post['id']}/responses/generate",
        json={"agent_id": LIANNE_AGENT_ID},
    )
    assert result.status_code == 409


@pytest.mark.parametrize(
    "category",
    [
        "openai_timeout",
        "openai_authentication_failed",
        "openai_refusal",
        "openai_incomplete_output",
        "openai_invalid_output",
    ],
)
def test_generation_failure_creates_no_content_and_safe_audit(client, category: str) -> None:
    http, database = client
    activate(http, DEMO_NPI, DEMO_AGENT_ID, voice=True)
    use_fake(FakeGenerationService(error=category))
    raw_request = "Sensitive-looking synthetic request marker ABC-RAW-MARKER"
    response = http.post(
        "/forum/posts/drafts/generate",
        json={"agent_id": DEMO_AGENT_ID, "raw_request": raw_request},
    )
    assert response.status_code in {502, 503}
    assert raw_request not in response.text
    with sqlite3.connect(database) as connection:
        assert connection.execute("SELECT COUNT(*) FROM forum_posts").fetchone()[0] == 0
        event = connection.execute(
            """
            SELECT metadata_json FROM agent_audit_events
            WHERE action='post_generation_failed'
            """
        ).fetchone()[0]
    assert "ABC-RAW-MARKER" not in event
    assert category in event


def test_strict_generated_models_reject_extra_fields_and_unsupported_types() -> None:
    with pytest.raises(ValidationError):
        GeneratedPostDraft.model_validate(
            {
                "title": "Title",
                "clinical_question": "Question",
                "context_summary": "Context",
                "specialty_tags": [],
                "uncertainties": [],
                "status": "published",
            }
        )
    with pytest.raises(ValidationError):
        GeneratedResponseDraft.model_validate(
            {
                "response_type": "diagnosis",
                "headline": "Headline",
                "content": "Content",
                "citations": [],
                "uncertainties": [],
            }
        )


@pytest.mark.parametrize("phrase", DRAFT_STATE_PHRASES)
def test_generated_models_reject_workflow_and_citation_bookkeeping(phrase: str) -> None:
    with pytest.raises(ValidationError, match="workflow metadata"):
        GeneratedPostDraft(
            title="Synthetic question",
            clinical_question="What context would help?",
            context_summary=f"Synthetic clinical facts. {phrase}.",
            specialty_tags=[],
        )
    with pytest.raises(ValidationError, match="workflow metadata"):
        GeneratedResponseDraft(
            response_type="clinical_consideration",
            headline="A bounded consideration",
            content=f"Synthetic clinical facts. {phrase}.",
            citations=[],
        )
    with pytest.raises(ValidationError, match="workflow metadata"):
        MonitoringResponseDraft(
            response_type="clinical_consideration",
            headline="A bounded consideration",
            content=f"Synthetic clinical facts. {phrase}.",
        )


def test_generation_instructions_keep_metadata_out_of_clinical_content() -> None:
    instructions = physician_agent_instructions(
        {
            "physician_name": "Ethan Bell, MD, MS",
            "agent_id": "agent-9000000999",
            "verified_specialties": ["Internal Medicine"],
            "declared_expertise_tags": [],
            "monitoring_topics": [],
            "citations_required": True,
            "publication_mode": "requires_physician_approval",
        }
    )
    assert "structured status and provenance metadata" in instructions
    assert "return citations=[]" in instructions
    assert "Never narrate workflow state" in instructions
