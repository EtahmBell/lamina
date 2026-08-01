from __future__ import annotations

import json
import os
import sqlite3
from datetime import UTC, datetime
from pathlib import Path
from uuid import uuid4

DEMO_ORGANIZATION_ID = "org-lamina-demo-medical-group"
DEMO_ORGANIZATION_NAME = "Lamina Demo Medical Group"
DEMO_ORGANIZATION_SLUG = "lamina-demo-medical-group"
DEMO_MEDPLUM_CONNECTION_ID = "medplum-lamina-demo-medical-group"
DEFAULT_MEDPLUM_CREDENTIAL_KEY = "DEFAULT_MEDPLUM"
DEMO_MEMBERS = (
    ("org-member-ethan-bell", "9000000999", "agent-9000000999", "admin"),
    ("org-member-lianne-cha", "9000001000", "agent-9000001000", "physician"),
)


def utc_now() -> str:
    return datetime.now(UTC).isoformat().replace("+00:00", "Z")


def _columns(connection: sqlite3.Connection, table: str) -> set[str]:
    return {str(row[1]) for row in connection.execute(f"PRAGMA table_info({table})")}


def migrate_organization_schema(connection: sqlite3.Connection) -> None:
    connection.executescript(
        """
        CREATE TABLE IF NOT EXISTS organizations (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          slug TEXT NOT NULL UNIQUE,
          status TEXT NOT NULL CHECK (status IN ('active', 'inactive')),
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS organization_members (
          id TEXT PRIMARY KEY,
          organization_id TEXT NOT NULL REFERENCES organizations(id),
          physician_npi TEXT NOT NULL REFERENCES physicians(npi),
          agent_id TEXT NOT NULL REFERENCES agents(id),
          role TEXT NOT NULL CHECK (role IN ('physician', 'admin')),
          status TEXT NOT NULL CHECK (status IN ('active', 'inactive')),
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          UNIQUE(organization_id, agent_id)
        );

        CREATE TABLE IF NOT EXISTS organization_medplum_connections (
          id TEXT PRIMARY KEY,
          organization_id TEXT NOT NULL REFERENCES organizations(id),
          connection_type TEXT NOT NULL CHECK (connection_type = 'medplum'),
          base_url TEXT NOT NULL,
          token_url TEXT NOT NULL,
          fhir_base_url TEXT NOT NULL,
          project_id TEXT NOT NULL,
          credential_source TEXT NOT NULL CHECK (credential_source = 'environment'),
          credential_key TEXT NOT NULL CHECK (credential_key = 'DEFAULT_MEDPLUM'),
          status TEXT NOT NULL CHECK (
            status IN ('unconfigured', 'configured', 'connected', 'error', 'inactive')
          ),
          last_verified_at TEXT,
          last_error_category TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          UNIQUE(organization_id, connection_type)
        );

        CREATE UNIQUE INDEX IF NOT EXISTS idx_organization_members_one_active_agent
          ON organization_members(agent_id) WHERE status = 'active';
        CREATE INDEX IF NOT EXISTS idx_organization_members_organization
          ON organization_members(organization_id, status, created_at);
        CREATE INDEX IF NOT EXISTS idx_org_medplum_connections_organization
          ON organization_medplum_connections(organization_id, status);
        """
    )
    for table in ("forum_medplum_links", "medplum_practitioner_links"):
        existing = _columns(connection, table)
        if "organization_id" not in existing:
            connection.execute(f"ALTER TABLE {table} ADD COLUMN organization_id TEXT")
        if "medplum_connection_id" not in existing:
            connection.execute(f"ALTER TABLE {table} ADD COLUMN medplum_connection_id TEXT")


def _audit(
    connection: sqlite3.Connection,
    action: str,
    metadata: dict[str, str],
    created_at: str,
) -> None:
    connection.execute(
        """
        INSERT INTO integration_audit_events (id, action, metadata_json, created_at)
        VALUES (?, ?, json(?), ?)
        """,
        (
            str(uuid4()),
            action,
            json.dumps(metadata),
            created_at,
        ),
    )


def bootstrap_demo_organization(connection: sqlite3.Connection) -> dict[str, object] | None:
    migrate_organization_schema(connection)
    demo_agents = {
        str(row[0])
        for row in connection.execute(
            "SELECT id FROM agents WHERE id IN ('agent-9000000999', 'agent-9000001000')"
        )
    }
    if not demo_agents:
        return None

    now = utc_now()
    organization_exists = connection.execute(
        "SELECT 1 FROM organizations WHERE id=?", (DEMO_ORGANIZATION_ID,)
    ).fetchone()
    connection.execute(
        """
        INSERT INTO organizations (id, name, slug, status, created_at, updated_at)
        VALUES (?, ?, ?, 'active', ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          name=excluded.name, slug=excluded.slug, updated_at=excluded.updated_at
        """,
        (
            DEMO_ORGANIZATION_ID,
            DEMO_ORGANIZATION_NAME,
            DEMO_ORGANIZATION_SLUG,
            now,
            now,
        ),
    )
    if organization_exists is None:
        _audit(
            connection,
            "organization_created",
            {"organization_id": DEMO_ORGANIZATION_ID},
            now,
        )

    added_members = 0
    for member_id, npi, agent_id, role in DEMO_MEMBERS:
        if agent_id not in demo_agents:
            continue
        existed = connection.execute(
            "SELECT 1 FROM organization_members WHERE organization_id=? AND agent_id=?",
            (DEMO_ORGANIZATION_ID, agent_id),
        ).fetchone()
        connection.execute(
            """
            INSERT INTO organization_members (
              id, organization_id, physician_npi, agent_id, role, status,
              created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, 'active', ?, ?)
            ON CONFLICT(organization_id, agent_id) DO UPDATE SET
              physician_npi=excluded.physician_npi,
              role=excluded.role,
              updated_at=excluded.updated_at
            """,
            (member_id, DEMO_ORGANIZATION_ID, npi, agent_id, role, now, now),
        )
        if existed is None:
            added_members += 1
            _audit(
                connection,
                "organization_member_added",
                {
                    "organization_id": DEMO_ORGANIZATION_ID,
                    "physician_npi": npi,
                    "agent_id": agent_id,
                },
                now,
            )

    base_url = os.getenv("MEDPLUM_BASE_URL", "").strip().rstrip("/")
    token_url = os.getenv("MEDPLUM_TOKEN_URL", "").strip()
    fhir_base_url = os.getenv("MEDPLUM_FHIR_BASE_URL", "").strip().rstrip("/")
    if base_url and not fhir_base_url:
        fhir_base_url = f"{base_url}/fhir/R4"
    project_id = os.getenv("MEDPLUM_PROJECT_ID", "").strip()
    configured = all(
        os.getenv(name, "").strip()
        for name in (
            "MEDPLUM_BASE_URL",
            "MEDPLUM_TOKEN_URL",
            "MEDPLUM_CLIENT_ID",
            "MEDPLUM_CLIENT_SECRET",
            "MEDPLUM_PROJECT_ID",
        )
    )
    connection_exists = connection.execute(
        "SELECT 1 FROM organization_medplum_connections WHERE id=?",
        (DEMO_MEDPLUM_CONNECTION_ID,),
    ).fetchone()
    connection.execute(
        """
        INSERT INTO organization_medplum_connections (
          id, organization_id, connection_type, base_url, token_url,
          fhir_base_url, project_id, credential_source, credential_key,
          status, created_at, updated_at
        ) VALUES (?, ?, 'medplum', ?, ?, ?, ?, 'environment', ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          base_url=CASE WHEN excluded.base_url != '' THEN excluded.base_url ELSE base_url END,
          token_url=CASE WHEN excluded.token_url != '' THEN excluded.token_url ELSE token_url END,
          fhir_base_url=CASE
            WHEN excluded.fhir_base_url != '' THEN excluded.fhir_base_url ELSE fhir_base_url END,
          project_id=CASE WHEN excluded.project_id != '' THEN excluded.project_id ELSE project_id END,
          status=CASE
            WHEN organization_medplum_connections.status IN ('connected', 'error')
              THEN organization_medplum_connections.status
            ELSE excluded.status END,
          updated_at=excluded.updated_at
        """,
        (
            DEMO_MEDPLUM_CONNECTION_ID,
            DEMO_ORGANIZATION_ID,
            base_url,
            token_url,
            fhir_base_url,
            project_id,
            DEFAULT_MEDPLUM_CREDENTIAL_KEY,
            "configured" if configured else "unconfigured",
            now,
            now,
        ),
    )
    if connection_exists is None:
        _audit(
            connection,
            "medplum_org_connection_created",
            {
                "organization_id": DEMO_ORGANIZATION_ID,
                "connection_id": DEMO_MEDPLUM_CONNECTION_ID,
                "credential_source": "environment",
                "status": "configured" if configured else "unconfigured",
            },
            now,
        )

    connection.execute(
        """
        UPDATE medplum_practitioner_links
        SET organization_id=?, medplum_connection_id=?, updated_at=?
        WHERE agent_id IN ('agent-9000000999', 'agent-9000001000')
          AND (organization_id IS NULL OR medplum_connection_id IS NULL)
        """,
        (DEMO_ORGANIZATION_ID, DEMO_MEDPLUM_CONNECTION_ID, now),
    )
    connection.execute(
        """
        UPDATE forum_medplum_links
        SET organization_id=?, medplum_connection_id=?, updated_at=?
        WHERE created_by_agent_id IN ('agent-9000000999', 'agent-9000001000')
          AND (organization_id IS NULL OR medplum_connection_id IS NULL)
        """,
        (DEMO_ORGANIZATION_ID, DEMO_MEDPLUM_CONNECTION_ID, now),
    )
    return {
        "organization_id": DEMO_ORGANIZATION_ID,
        "connection_id": DEMO_MEDPLUM_CONNECTION_ID,
        "members_added": added_members,
        "configured": configured,
    }


def seed_demo_organization(database: Path) -> dict[str, object]:
    if not database.exists():
        raise FileNotFoundError(
            f"Lamina database not found at {database}. Build the directory first."
        )
    with sqlite3.connect(database) as connection:
        connection.execute("PRAGMA foreign_keys = ON")
        result = bootstrap_demo_organization(connection)
    if result is None:
        raise RuntimeError("Seed the synthetic demo physicians before their organization")
    return result
