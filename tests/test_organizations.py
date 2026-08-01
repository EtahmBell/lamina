from __future__ import annotations

import json
import sqlite3
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

import api.main as api_main
from api.medplum import MedplumError, MedplumSettings, create_medplum_service
from api.organization_medplum import (
    OrganizationError,
    get_medplum_service_for_agent,
    get_organization_membership_for_agent,
    resolve_medplum_credentials,
)
from lamina_directory.demo_organization import (
    DEFAULT_MEDPLUM_CREDENTIAL_KEY,
    DEMO_MEDPLUM_CONNECTION_ID,
    DEMO_ORGANIZATION_ID,
    seed_demo_organization,
)
from lamina_directory.seed_demo_physician import seed_demo_physician

ENVIRONMENT = {
    "MEDPLUM_BASE_URL": "https://example.medplum.test",
    "MEDPLUM_TOKEN_URL": "https://example.medplum.test/oauth2/token",
    "MEDPLUM_FHIR_BASE_URL": "https://example.medplum.test/fhir/R4",
    "MEDPLUM_CLIENT_ID": "environment-client-id",
    "MEDPLUM_CLIENT_SECRET": "environment-secret-marker",
    "MEDPLUM_PROJECT_ID": "environment-project-id",
}


class FakeMedplumHealth:
    async def health(self) -> dict[str, object]:
        return {
            "configured": True,
            "authenticated": True,
            "fhir_reachable": True,
            "project_id_configured": True,
            "client_secret": "environment-secret-marker",
        }


def make_database(path: Path) -> None:
    schema = Path(__file__).parents[1] / "sql" / "schema.sql"
    with sqlite3.connect(path) as connection:
        connection.executescript(schema.read_text(encoding="utf-8"))
        connection.execute(
            """
            INSERT INTO physicians (npi, display_name, primary_specialty, source)
            VALUES ('1234567890', 'Existing NPPES Physician, MD', 'Cardiology', 'NPPES')
            """
        )
        connection.execute(
            "INSERT INTO agents (id, physician_npi) VALUES ('agent-nppes', '1234567890')"
        )
    seed_demo_physician(path)


@pytest.fixture
def organization_database(tmp_path: Path) -> Path:
    database = tmp_path / "lamina.sqlite"
    make_database(database)
    return database


def configured_environment(monkeypatch: pytest.MonkeyPatch) -> None:
    for name, value in ENVIRONMENT.items():
        monkeypatch.setenv(name, value)


def test_demo_organization_seed_is_idempotent_and_preserves_existing_state(
    organization_database: Path,
) -> None:
    with sqlite3.connect(organization_database) as connection:
        connection.execute(
            "UPDATE agents SET status='active', claimed=1 WHERE id='agent-9000000999'"
        )
    seed_demo_organization(organization_database)
    seed_demo_organization(organization_database)

    with sqlite3.connect(organization_database) as connection:
        organization = connection.execute(
            "SELECT name, slug, status FROM organizations WHERE id=?",
            (DEMO_ORGANIZATION_ID,),
        ).fetchone()
        members = connection.execute(
            """
            SELECT agent_id, physician_npi, role, status
            FROM organization_members WHERE organization_id=? ORDER BY agent_id
            """,
            (DEMO_ORGANIZATION_ID,),
        ).fetchall()
        counts = connection.execute(
            """
            SELECT
              (SELECT count(*) FROM organizations WHERE id=?),
              (SELECT count(*) FROM organization_members WHERE organization_id=?),
              (SELECT count(*) FROM physicians WHERE source='NPPES')
            """,
            (DEMO_ORGANIZATION_ID, DEMO_ORGANIZATION_ID),
        ).fetchone()
        ethan_state = connection.execute(
            "SELECT status, claimed FROM agents WHERE id='agent-9000000999'"
        ).fetchone()

    assert organization == ("Lamina Demo Medical Group", "lamina-demo-medical-group", "active")
    assert members == [
        ("agent-9000000999", "9000000999", "admin", "active"),
        ("agent-9000001000", "9000001000", "physician", "active"),
    ]
    assert counts == (1, 2, 1)
    assert ethan_state == ("active", 1)


def test_connection_record_references_environment_without_storing_secret(
    organization_database: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    configured_environment(monkeypatch)
    seed_demo_organization(organization_database)
    with sqlite3.connect(organization_database) as connection:
        connection.row_factory = sqlite3.Row
        record = connection.execute(
            "SELECT * FROM organization_medplum_connections WHERE id=?",
            (DEMO_MEDPLUM_CONNECTION_ID,),
        ).fetchone()
        column_names = {
            row[1]
            for row in connection.execute(
                "PRAGMA table_info(organization_medplum_connections)"
            )
        }
        dump = "\n".join(connection.iterdump())

    assert record["credential_source"] == "environment"
    assert record["credential_key"] == DEFAULT_MEDPLUM_CREDENTIAL_KEY
    assert record["status"] == "configured"
    assert "client_secret" not in column_names
    assert ENVIRONMENT["MEDPLUM_CLIENT_SECRET"] not in dump


def test_credential_resolver_loads_environment_and_rejects_invalid_configuration() -> None:
    record = {
        "credential_source": "environment",
        "credential_key": DEFAULT_MEDPLUM_CREDENTIAL_KEY,
    }
    settings = resolve_medplum_credentials(record, ENVIRONMENT)
    assert settings.client_id == ENVIRONMENT["MEDPLUM_CLIENT_ID"]
    assert settings.client_secret == ENVIRONMENT["MEDPLUM_CLIENT_SECRET"]
    assert settings.project_id == ENVIRONMENT["MEDPLUM_PROJECT_ID"]

    with pytest.raises(MedplumError, match="medplum_environment_credentials_missing"):
        resolve_medplum_credentials(record, {})
    with pytest.raises(OrganizationError, match="unsupported_medplum_credential_source"):
        resolve_medplum_credentials(
            {"credential_source": "plaintext", "credential_key": "DEFAULT_MEDPLUM"},
            ENVIRONMENT,
        )
    with pytest.raises(OrganizationError, match="unsupported_medplum_credential_key"):
        resolve_medplum_credentials(
            {"credential_source": "environment", "credential_key": "UNKNOWN"},
            ENVIRONMENT,
        )


def test_agent_resolution_requires_exactly_one_active_membership(
    organization_database: Path,
) -> None:
    with sqlite3.connect(organization_database) as connection:
        connection.row_factory = sqlite3.Row
        assert (
            get_organization_membership_for_agent(connection, "agent-9000000999")[
                "organization_id"
            ]
            == DEMO_ORGANIZATION_ID
        )
        assert (
            get_organization_membership_for_agent(connection, "agent-9000001000")[
                "organization_id"
            ]
            == DEMO_ORGANIZATION_ID
        )
        with pytest.raises(OrganizationError, match="organization_membership_missing"):
            get_organization_membership_for_agent(connection, "agent-nppes")

        connection.execute("DROP INDEX idx_organization_members_one_active_agent")
        connection.execute(
            """
            INSERT INTO organizations (id, name, slug, status, created_at, updated_at)
            VALUES ('org-two', 'Second Organization', 'second-organization', 'active', 'now', 'now')
            """
        )
        connection.execute(
            """
            INSERT INTO organization_members (
              id, organization_id, physician_npi, agent_id, role, status, created_at, updated_at
            ) VALUES (
              'member-two', 'org-two', '9000000999', 'agent-9000000999',
              'physician', 'active', 'now', 'now'
            )
            """
        )
        with pytest.raises(OrganizationError, match="organization_membership_ambiguous"):
            get_organization_membership_for_agent(connection, "agent-9000000999")


def test_agent_medplum_resolution_uses_organization_connection(
    organization_database: Path,
) -> None:
    fake = FakeMedplumHealth()
    with sqlite3.connect(organization_database) as connection:
        connection.row_factory = sqlite3.Row
        for agent_id in ("agent-9000000999", "agent-9000001000"):
            resolved = get_medplum_service_for_agent(connection, agent_id, fake)
            assert resolved.organization_id == DEMO_ORGANIZATION_ID
            assert resolved.connection_id == DEMO_MEDPLUM_CONNECTION_ID
            assert resolved.agent_id == agent_id
            assert resolved.service is fake


def test_service_cache_is_scoped_by_connection_identity() -> None:
    settings = MedplumSettings(
        base_url="https://example.medplum.test",
        token_url="https://example.medplum.test/oauth2/token",
        fhir_base_url="https://example.medplum.test/fhir/R4",
        client_id="client",
        client_secret="secret",
        project_id="project",
        timeout_seconds=5,
    )
    first = create_medplum_service(settings, connection_id="connection-one")
    same = create_medplum_service(settings, connection_id="connection-one")
    other = create_medplum_service(settings, connection_id="connection-two")
    assert first is same
    assert first is not other


def test_organization_endpoints_and_connection_test_are_secret_safe(
    organization_database: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    configured_environment(monkeypatch)
    seed_demo_organization(organization_database)
    monkeypatch.setattr(api_main, "DB_PATH", organization_database)
    api_main.app.dependency_overrides[api_main.get_medplum_service] = FakeMedplumHealth
    try:
        client = TestClient(api_main.app)
        responses = [
            client.get("/organizations"),
            client.get(f"/organizations/{DEMO_ORGANIZATION_ID}"),
            client.get(f"/organizations/{DEMO_ORGANIZATION_ID}/members"),
            client.get(
                f"/organizations/{DEMO_ORGANIZATION_ID}/integrations/medplum"
            ),
            client.post(
                f"/organizations/{DEMO_ORGANIZATION_ID}/integrations/medplum/test"
            ),
        ]
    finally:
        api_main.app.dependency_overrides.clear()

    assert all(response.status_code == 200 for response in responses)
    encoded = json.dumps([response.json() for response in responses])
    assert "environment-secret-marker" not in encoded
    assert "client_secret" not in encoded
    assert "credential_key" not in encoded
    assert responses[0].json()["count"] == 1
    assert responses[2].json()["count"] == 2
    assert responses[3].json()["configured"] is True
    assert responses[4].json()["status"] == "connected"
    with sqlite3.connect(organization_database) as connection:
        record = connection.execute(
            """
            SELECT status, last_verified_at, last_error_category
            FROM organization_medplum_connections WHERE id=?
            """,
            (DEMO_MEDPLUM_CONNECTION_ID,),
        ).fetchone()
        audit = connection.execute(
            """
            SELECT metadata_json FROM integration_audit_events
            WHERE action='medplum_org_connection_test_succeeded'
            ORDER BY created_at DESC LIMIT 1
            """
        ).fetchone()[0]
    assert record[0] == "connected"
    assert record[1] is not None
    assert record[2] is None
    assert "environment-secret-marker" not in audit
