from __future__ import annotations

import sqlite3
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

import api.main as api_main


@pytest.fixture
def client(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> TestClient:
    database = tmp_path / "lamina.sqlite"
    schema = Path(__file__).parents[1] / "sql" / "schema.sql"
    with sqlite3.connect(database) as connection:
        connection.executescript(schema.read_text(encoding="utf-8"))
        physicians = [
            ("1234567890", "Real Doctor, MD", "Internal Medicine Physician", "NPPES"),
            ("9000000001", "Maya Patel, MD", "Family Medicine Physician", "SYNTHETIC"),
            ("9000000002", "No Specialty, MD", None, "SYNTHETIC"),
        ]
        connection.executemany(
            """
            INSERT INTO physicians
              (npi, display_name, primary_specialty, source, profile_status)
            VALUES (?, ?, ?, ?, 'unclaimed')
            """,
            physicians,
        )
        connection.executemany(
            """
            INSERT INTO agents (id, physician_npi, status, claimed, public_posting_enabled)
            VALUES (?, ?, 'reserved', 0, 0)
            """,
            [(f"agent-{npi}", npi) for npi, *_ in physicians],
        )
        connection.executemany(
            "INSERT INTO physician_fts(npi, display_name, primary_specialty) VALUES (?, ?, ?)",
            [(npi, name, specialty or "") for npi, name, specialty, _ in physicians],
        )
    monkeypatch.setattr(api_main, "DB_PATH", database)
    return TestClient(api_main.app)


def claim(client: TestClient, npi: str = "9000000001") -> dict[str, object]:
    response = client.post(f"/physicians/{npi}/claims")
    assert response.status_code == 200
    return response.json()


def verify(client: TestClient, npi: str = "9000000001") -> dict[str, object]:
    requested = claim(client, npi)
    response = client.post(f"/claims/{requested['claim']['id']}/verify-demo")
    assert response.status_code == 200
    return response.json()


def configure(client: TestClient, npi: str = "9000000001", **overrides: object):
    body: dict[str, object] = {
        "declared_expertise_tags": ["Hypertension", " hypertension ", "Diabetes"],
        "monitoring_topics": ["Health policy", "Cardiology"],
        "voice_post_drafting_enabled": True,
        "response_drafting_enabled": True,
        "thread_summaries_enabled": True,
        "citations_required": True,
        "publication_mode": "requires_physician_approval",
        "report_cadence": "weekly",
        "report_topics": ["Care quality"],
        "report_source_scope": "network_and_medplum",
        "report_length": "detailed",
        "notifications": ["report_ready", "draft_response_ready", "report_ready"],
    }
    body.update(overrides)
    return client.put(f"/agents/agent-{npi}/configuration", json=body)


def test_imported_and_synthetic_physicians_begin_reserved(client: TestClient) -> None:
    for npi, source in (("1234567890", "NPPES"), ("9000000001", "SYNTHETIC")):
        result = client.get(f"/agents/agent-{npi}").json()
        assert result["status"] == "reserved"
        assert result["physician"]["profile_status"] == "unclaimed"
        assert result["physician"]["data_source"] == source
        assert not any(
            result["effective_permissions"][permission]
            for permission in (
                "can_draft_voice_posts",
                "can_draft_responses",
                "can_generate_reports",
                "can_publish_clinical_content",
            )
        )


def test_reserved_agent_cannot_activate_and_attempt_is_audited(client: TestClient) -> None:
    response = client.post("/agents/agent-9000000001/activate")
    assert response.status_code == 409
    with api_main.connect() as connection:
        actions = [row[0] for row in connection.execute("SELECT action FROM agent_audit_events")]
    assert actions == ["invalid_transition_attempted"]


def test_claim_is_idempotent_and_moves_agent_to_pending(client: TestClient) -> None:
    first = claim(client)
    second = claim(client)
    assert first["claim"]["id"] == second["claim"]["id"]
    assert second["agent_status"] == "claim_pending"


def test_real_nppes_physician_cannot_use_demo_verification(client: TestClient) -> None:
    requested = claim(client, "1234567890")
    response = client.post(f"/claims/{requested['claim']['id']}/verify-demo")
    assert response.status_code == 403
    assert "NPPES" in response.json()["detail"]
    with api_main.connect() as connection:
        actions = [row[0] for row in connection.execute(
            "SELECT action FROM agent_audit_events ORDER BY created_at"
        )]
    assert actions == ["claim_requested", "claim_demo_verification_rejected"]


def test_synthetic_physician_can_verify_but_cannot_activate_without_config(
    client: TestClient,
) -> None:
    verified = verify(client)
    assert verified["agent_status"] == "verified"
    response = client.post("/agents/agent-9000000001/activate")
    assert response.status_code == 409
    assert "configuration_saved" in response.json()["detail"]


def test_configuration_requires_verified_claim(client: TestClient) -> None:
    response = configure(client)
    assert response.status_code == 409
    claim(client)
    response = configure(client)
    assert response.status_code == 409


def test_configuration_separates_expertise_and_monitoring_and_normalizes(
    client: TestClient,
) -> None:
    verify(client)
    response = configure(client)
    assert response.status_code == 200
    result = response.json()
    config = result["configuration"]
    assert result["status"] == "configuring"
    assert config["verified_specialties"] == ["Family Medicine Physician"]
    assert config["declared_expertise_tags"] == ["Hypertension", "Diabetes"]
    assert config["monitoring_topics"] == ["Health policy", "Cardiology"]
    assert config["notifications"] == ["report_ready", "draft_response_ready"]
    assert config["report_cadence"] == "weekly"
    assert config["report_source_scope"] == "network_and_medplum"
    assert config["report_length"] == "detailed"


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("publication_mode", "autonomous"),
        ("report_cadence", "daily"),
        ("report_source_scope", "internet"),
        ("report_length", "novel"),
    ],
)
def test_configuration_rejects_invalid_enums(
    client: TestClient, field: str, value: str
) -> None:
    verify(client)
    response = configure(client, **{field: value})
    assert response.status_code == 422


def test_agent_without_verified_specialty_cannot_activate(client: TestClient) -> None:
    verify(client, "9000000002")
    response = configure(client, "9000000002")
    assert response.status_code == 200
    readiness = client.get("/agents/agent-9000000002/activation-readiness").json()
    assert readiness["requirements"]["verified_specialty_present"] is False
    assert client.post("/agents/agent-9000000002/activate").status_code == 409


def test_full_activation_pause_reactivation_permissions_and_audit(client: TestClient) -> None:
    verify(client)
    assert configure(client).status_code == 200
    activated = client.post("/agents/agent-9000000001/activate")
    assert activated.status_code == 200
    result = activated.json()
    assert result["status"] == "active"
    assert result["activation_readiness"]["ready"] is True
    assert result["effective_permissions"] == {
        "can_draft_voice_posts": True,
        "can_draft_responses": True,
        "can_generate_reports": True,
        "can_publish_clinical_content": False,
        "requires_physician_approval": True,
    }
    assert client.post("/agents/agent-9000000001/activate").status_code == 200
    paused = client.post("/agents/agent-9000000001/pause")
    assert paused.status_code == 200
    assert paused.json()["status"] == "paused"
    assert paused.json()["effective_permissions"]["can_draft_responses"] is False
    assert client.post("/agents/agent-9000000001/pause").status_code == 200
    assert client.post("/agents/agent-9000000001/activate").json()["status"] == "active"
    with api_main.connect() as connection:
        actions = [row[0] for row in connection.execute(
            "SELECT action FROM agent_audit_events ORDER BY rowid"
        )]
    assert actions == [
        "claim_requested",
        "claim_demo_verified",
        "configuration_created",
        "agent_activated",
        "agent_paused",
        "agent_activated",
    ]


def test_configuration_update_is_audited_and_preserves_active_state(client: TestClient) -> None:
    verify(client)
    configure(client)
    client.post("/agents/agent-9000000001/activate")
    updated = configure(client, report_cadence="monthly", report_topics=[" Equity ", "equity"])
    assert updated.status_code == 200
    assert updated.json()["status"] == "active"
    assert updated.json()["configuration"]["report_cadence"] == "monthly"
    assert updated.json()["configuration"]["report_topics"] == ["Equity"]
    with api_main.connect() as connection:
        assert connection.execute(
            "SELECT COUNT(*) FROM agent_audit_events WHERE action='configuration_updated'"
        ).fetchone()[0] == 1


def test_existing_directory_search_still_works(client: TestClient) -> None:
    response = client.get("/physicians/search", params={"q": "Maya Patel"})
    assert response.status_code == 200
    assert response.json()["results"][0]["agent_status"] == "reserved"
