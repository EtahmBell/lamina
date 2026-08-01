from __future__ import annotations

import sqlite3
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

import api.main as api_main
from lamina_directory.seed_demo_physician import (
    DEMO_AGENT_ID,
    DEMO_NPI,
    LIANNE_AGENT_ID,
    LIANNE_NPI,
    seed_demo_physician,
)


@pytest.fixture
def client(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> TestClient:
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
    return TestClient(api_main.app)


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


def post_draft_body(agent_id: str = DEMO_AGENT_ID) -> dict[str, object]:
    return {
        "agent_id": agent_id,
        "title": "Persistent nausea after medication change",
        "clinical_question": (
            "Have others observed persistent nausea beginning within three days "
            "of this medication change?"
        ),
        "context_summary": (
            "Synthetic adult patient. No identifying patient information is included."
        ),
        "specialty_tags": ["Internal Medicine", "Endocrinology"],
        "case_classification": "synthetic",
        "draft_origin": "physician_text_request",
    }


def response_draft_body(agent_id: str = LIANNE_AGENT_ID) -> dict[str, object]:
    return {
        "agent_id": agent_id,
        "response_type": "clinical_consideration",
        "headline": "Clarify timing and medication exposure",
        "content": (
            "The timing may be clinically relevant. Clarify whether symptoms recur "
            "after each dose and whether other medications changed."
        ),
        "citations": [],
        "draft_origin": "physician_text_request",
    }


def test_reserved_agent_cannot_draft_and_real_cases_are_rejected(client: TestClient) -> None:
    assert client.post("/forum/posts/drafts", json=post_draft_body()).status_code == 409
    body = post_draft_body()
    body["case_classification"] = "real_patient"
    assert client.post("/forum/posts/drafts", json=body).status_code == 422


def test_paused_or_disabled_drafting_permission_cannot_create_post(
    client: TestClient,
) -> None:
    activate(client, DEMO_NPI, DEMO_AGENT_ID, voice=True)
    assert client.post(f"/agents/{DEMO_AGENT_ID}/pause").status_code == 200
    assert client.post("/forum/posts/drafts", json=post_draft_body()).status_code == 409

    activate(client, LIANNE_NPI, LIANNE_AGENT_ID, voice=False)
    assert (
        client.post(
            "/forum/posts/drafts", json=post_draft_body(LIANNE_AGENT_ID)
        ).status_code
        == 409
    )


def test_question_approval_feed_provenance_and_ownership(client: TestClient) -> None:
    activate(client, DEMO_NPI, DEMO_AGENT_ID, voice=True)
    draft = client.post("/forum/posts/drafts", json=post_draft_body())
    assert draft.status_code == 200
    post = draft.json()
    assert post["status"] == "awaiting_physician_approval"
    assert client.get("/forum/posts").json()["posts"] == []

    wrong = client.post(
        f"/forum/posts/{post['id']}/approve", json={"physician_npi": LIANNE_NPI}
    )
    assert wrong.status_code == 403
    approved = client.post(
        f"/forum/posts/{post['id']}/approve", json={"physician_npi": DEMO_NPI}
    )
    assert approved.status_code == 200
    assert approved.json()["case_classification"] == "synthetic"
    assert approved.json()["provenance"]["physician_approved"] is True
    assert approved.json()["provenance"]["approved_at"]
    assert approved.json()["author"]["agent_id"] == DEMO_AGENT_ID
    assert client.post(
        f"/forum/posts/{post['id']}/approve", json={"physician_npi": DEMO_NPI}
    ).status_code == 200
    feed = client.get("/forum/posts", params={"specialty": "Endocrinology"}).json()
    assert [item["id"] for item in feed["posts"]] == [post["id"]]
    search = client.get("/forum/posts", params={"q": "medication change"}).json()
    assert [item["id"] for item in search["posts"]] == [post["id"]]
    assert client.get("/forum/posts", params={"q": "unrelated phrase"}).json()["posts"] == []


def test_response_requires_published_post(client: TestClient) -> None:
    activate(client, DEMO_NPI, DEMO_AGENT_ID, voice=True)
    activate(client, LIANNE_NPI, LIANNE_AGENT_ID, responses=True)
    post = client.post("/forum/posts/drafts", json=post_draft_body()).json()
    response = client.post(
        f"/forum/posts/{post['id']}/responses/drafts",
        json=response_draft_body(),
    )
    assert response.status_code == 409


def test_complete_ethan_to_lianne_response_workflow(client: TestClient) -> None:
    activate(client, DEMO_NPI, DEMO_AGENT_ID, voice=True)
    activate(client, LIANNE_NPI, LIANNE_AGENT_ID, responses=True)
    post = client.post("/forum/posts/drafts", json=post_draft_body()).json()
    client.post(
        f"/forum/posts/{post['id']}/approve", json={"physician_npi": DEMO_NPI}
    )

    drafted = client.post(
        f"/forum/posts/{post['id']}/responses/drafts",
        json=response_draft_body(),
    )
    assert drafted.status_code == 200
    response = drafted.json()
    assert response["status"] == "awaiting_physician_approval"
    assert client.get(f"/forum/posts/{post['id']}").json()["responses"] == []
    ethan_inbox = client.get(f"/physicians/{DEMO_NPI}/review-inbox").json()
    lianne_inbox = client.get(f"/physicians/{LIANNE_NPI}/review-inbox").json()
    assert response["id"] not in {
        item["id"] for item in ethan_inbox["response_drafts"]
    }
    assert [item["id"] for item in lianne_inbox["response_drafts"]] == [response["id"]]
    assert client.post(
        f"/forum/responses/{response['id']}/approve",
        json={"physician_npi": DEMO_NPI},
    ).status_code == 403

    approved = client.post(
        f"/forum/responses/{response['id']}/approve",
        json={"physician_npi": LIANNE_NPI},
    )
    assert approved.status_code == 200
    assert approved.json()["provenance"]["physician_approved"] is True
    assert client.post(
        f"/forum/responses/{response['id']}/approve",
        json={"physician_npi": LIANNE_NPI},
    ).status_code == 200
    thread = client.get(f"/forum/posts/{post['id']}").json()
    assert thread["published_response_count"] == 1
    assert thread["responses"][0]["author"]["physician_npi"] == LIANNE_NPI

    with api_main.connect() as connection:
        actions = {
            row[0] for row in connection.execute("SELECT action FROM agent_audit_events")
        }
    assert {"post_draft_created", "post_approved", "response_draft_created"} <= actions
    assert {"response_approved", "unauthorized_approval_attempted"} <= actions


def test_rejected_content_and_review_inbox_are_private(client: TestClient) -> None:
    activate(client, DEMO_NPI, DEMO_AGENT_ID, voice=True)
    activate(client, LIANNE_NPI, LIANNE_AGENT_ID, voice=True, responses=True)
    ethan_post = client.post("/forum/posts/drafts", json=post_draft_body()).json()
    lianne_post = client.post(
        "/forum/posts/drafts", json=post_draft_body(LIANNE_AGENT_ID)
    ).json()

    ethan_inbox = client.get(f"/physicians/{DEMO_NPI}/review-inbox").json()
    lianne_inbox = client.get(f"/physicians/{LIANNE_NPI}/review-inbox").json()
    assert [item["id"] for item in ethan_inbox["post_drafts"]] == [ethan_post["id"]]
    assert [item["id"] for item in lianne_inbox["post_drafts"]] == [lianne_post["id"]]

    rejected = client.post(
        f"/forum/posts/{ethan_post['id']}/reject",
        json={"physician_npi": DEMO_NPI, "reason": "Needs more context"},
    )
    assert rejected.status_code == 200
    assert rejected.json()["status"] == "rejected"
    assert client.get("/forum/posts").json()["posts"] == []

    client.post(
        f"/forum/posts/{lianne_post['id']}/approve",
        json={"physician_npi": LIANNE_NPI},
    )
    response = client.post(
        f"/forum/posts/{lianne_post['id']}/responses/drafts",
        json=response_draft_body(),
    ).json()
    rejected_response = client.post(
        f"/forum/responses/{response['id']}/reject",
        json={"physician_npi": LIANNE_NPI, "reason": "I do not endorse this response"},
    )
    assert rejected_response.json()["status"] == "rejected"
    assert client.get(f"/forum/posts/{lianne_post['id']}").json()["responses"] == []
