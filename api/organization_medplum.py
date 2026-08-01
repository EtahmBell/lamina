from __future__ import annotations

import json
import os
import sqlite3
from collections.abc import Mapping
from dataclasses import dataclass
from datetime import UTC, datetime
from uuid import uuid4

from api.medplum import (
    MedplumError,
    MedplumService,
    MedplumSettings,
    create_medplum_service,
)
from api.models import MedplumCaseContext
from lamina_directory.demo_organization import (
    DEFAULT_MEDPLUM_CREDENTIAL_KEY,
    DEMO_ORGANIZATION_ID,
)


class OrganizationError(Exception):
    def __init__(self, category: str, *, not_found: bool = False) -> None:
        super().__init__(category)
        self.category = category
        self.not_found = not_found


@dataclass(frozen=True)
class ResolvedOrganizationMedplum:
    organization_id: str
    connection_id: str
    agent_id: str | None
    service: MedplumService


def utc_now() -> str:
    return datetime.now(UTC).isoformat().replace("+00:00", "Z")


def get_organization_membership_for_agent(
    connection: sqlite3.Connection, agent_id: str
) -> sqlite3.Row:
    rows = connection.execute(
        """
        SELECT om.*, o.name AS organization_name, o.slug AS organization_slug
        FROM organization_members om
        JOIN organizations o ON o.id=om.organization_id
        JOIN agents a ON a.id=om.agent_id AND a.physician_npi=om.physician_npi
        WHERE om.agent_id=? AND om.status='active' AND o.status='active'
        ORDER BY om.created_at, om.id
        """,
        (agent_id,),
    ).fetchall()
    if not rows:
        raise OrganizationError("organization_membership_missing", not_found=True)
    if len(rows) != 1:
        raise OrganizationError("organization_membership_ambiguous")
    return rows[0]


def get_organization_for_agent(
    connection: sqlite3.Connection, agent_id: str
) -> sqlite3.Row:
    membership = get_organization_membership_for_agent(connection, agent_id)
    organization = connection.execute(
        "SELECT * FROM organizations WHERE id=?", (membership["organization_id"],)
    ).fetchone()
    if organization is None:
        raise OrganizationError("organization_not_found", not_found=True)
    return organization


def get_medplum_connection_for_organization(
    connection: sqlite3.Connection, organization_id: str
) -> sqlite3.Row:
    organization = connection.execute(
        "SELECT * FROM organizations WHERE id=?", (organization_id,)
    ).fetchone()
    if organization is None:
        raise OrganizationError("organization_not_found", not_found=True)
    rows = connection.execute(
        """
        SELECT * FROM organization_medplum_connections
        WHERE organization_id=? AND connection_type='medplum' AND status != 'inactive'
        ORDER BY created_at, id
        """,
        (organization_id,),
    ).fetchall()
    if not rows:
        raise OrganizationError("organization_medplum_connection_missing", not_found=True)
    if len(rows) != 1:
        raise OrganizationError("organization_medplum_connection_ambiguous")
    return rows[0]


def resolve_medplum_credentials(
    connection: Mapping[str, object] | sqlite3.Row,
    environment: Mapping[str, str] | None = None,
) -> MedplumSettings:
    if connection["credential_source"] != "environment":
        raise OrganizationError("unsupported_medplum_credential_source")
    if connection["credential_key"] != DEFAULT_MEDPLUM_CREDENTIAL_KEY:
        raise OrganizationError("unsupported_medplum_credential_key")
    values = os.environ if environment is None else environment
    required = {
        name: values.get(name, "").strip()
        for name in (
            "MEDPLUM_BASE_URL",
            "MEDPLUM_TOKEN_URL",
            "MEDPLUM_CLIENT_ID",
            "MEDPLUM_CLIENT_SECRET",
            "MEDPLUM_PROJECT_ID",
        )
    }
    if not all(required.values()):
        raise MedplumError("medplum_environment_credentials_missing", configuration=True)
    fhir_base_url = values.get("MEDPLUM_FHIR_BASE_URL", "").strip().rstrip("/")
    base_url = required["MEDPLUM_BASE_URL"].rstrip("/")
    if not fhir_base_url:
        fhir_base_url = f"{base_url}/fhir/R4"
    try:
        timeout = float(values.get("MEDPLUM_REQUEST_TIMEOUT_SECONDS", "30"))
    except ValueError as error:
        raise MedplumError("medplum_configuration_invalid", configuration=True) from error
    if timeout <= 0:
        raise MedplumError("medplum_configuration_invalid", configuration=True)
    return MedplumSettings(
        base_url=base_url,
        token_url=required["MEDPLUM_TOKEN_URL"],
        fhir_base_url=fhir_base_url,
        client_id=required["MEDPLUM_CLIENT_ID"],
        client_secret=required["MEDPLUM_CLIENT_SECRET"],
        project_id=required["MEDPLUM_PROJECT_ID"],
        timeout_seconds=timeout,
    )


def resolve_medplum_service_for_organization(
    connection: sqlite3.Connection,
    organization_id: str,
    injected_service: MedplumService | None = None,
) -> ResolvedOrganizationMedplum:
    record = get_medplum_connection_for_organization(connection, organization_id)
    service = injected_service
    if service is None:
        settings = resolve_medplum_credentials(record)
        service = create_medplum_service(settings, connection_id=record["id"])
    return ResolvedOrganizationMedplum(
        organization_id=organization_id,
        connection_id=record["id"],
        agent_id=None,
        service=service,
    )


def get_medplum_service_for_agent(
    connection: sqlite3.Connection,
    agent_id: str,
    injected_service: MedplumService | None = None,
) -> ResolvedOrganizationMedplum:
    membership = get_organization_membership_for_agent(connection, agent_id)
    resolved = resolve_medplum_service_for_organization(
        connection, membership["organization_id"], injected_service
    )
    return ResolvedOrganizationMedplum(
        organization_id=resolved.organization_id,
        connection_id=resolved.connection_id,
        agent_id=agent_id,
        service=resolved.service,
    )


def get_demo_medplum_service(
    connection: sqlite3.Connection,
    injected_service: MedplumService | None = None,
) -> ResolvedOrganizationMedplum:
    return resolve_medplum_service_for_organization(
        connection, DEMO_ORGANIZATION_ID, injected_service
    )


def get_practitioner_id_for_agent(
    connection: sqlite3.Connection,
    resolved: ResolvedOrganizationMedplum,
    agent_id: str,
) -> str:
    if resolved.agent_id not in {None, agent_id}:
        raise OrganizationError("organization_medplum_agent_mismatch")
    row = connection.execute(
        "SELECT * FROM medplum_practitioner_links WHERE agent_id=?", (agent_id,)
    ).fetchone()
    if row is None:
        raise OrganizationError("medplum_practitioner_mapping_missing", not_found=True)
    if (
        row["organization_id"] != resolved.organization_id
        or row["medplum_connection_id"] != resolved.connection_id
    ):
        raise OrganizationError("medplum_practitioner_connection_mismatch")
    return str(row["medplum_practitioner_id"])


def validate_medplum_link_scope(
    link: sqlite3.Row, resolved: ResolvedOrganizationMedplum
) -> None:
    if (
        link["organization_id"] != resolved.organization_id
        or link["medplum_connection_id"] != resolved.connection_id
    ):
        raise OrganizationError("medplum_link_organization_mismatch")


async def get_authorized_case_for_agent(
    connection: sqlite3.Connection,
    resolved: ResolvedOrganizationMedplum,
    agent_id: str,
    patient_id: str,
) -> MedplumCaseContext:
    practitioner_id = get_practitioner_id_for_agent(connection, resolved, agent_id)
    return await resolved.service.get_authorized_case_context(practitioner_id, patient_id)


def environment_credentials_configured(
    record: sqlite3.Row, environment: Mapping[str, str] | None = None
) -> bool:
    try:
        resolve_medplum_credentials(record, environment)
    except (MedplumError, OrganizationError):
        return False
    return True


def safe_medplum_connection_payload(
    record: sqlite3.Row, environment: Mapping[str, str] | None = None
) -> dict[str, object]:
    values = os.environ if environment is None else environment
    return {
        "organization_id": record["organization_id"],
        "configured": environment_credentials_configured(record, values),
        "connection_type": record["connection_type"],
        "credential_source": record["credential_source"],
        "status": record["status"],
        "base_url": record["base_url"] or values.get("MEDPLUM_BASE_URL", ""),
        "project_id_configured": bool(
            record["project_id"] or values.get("MEDPLUM_PROJECT_ID", "")
        ),
        "last_verified_at": record["last_verified_at"],
        "last_error_category": record["last_error_category"],
    }


def record_medplum_connection_test(
    connection: sqlite3.Connection,
    record: sqlite3.Row,
    *,
    succeeded: bool,
    error_category: str | None = None,
) -> None:
    now = utc_now()
    status = "connected" if succeeded else "error"
    connection.execute(
        """
        UPDATE organization_medplum_connections
        SET status=?, last_verified_at=?, last_error_category=?, updated_at=?
        WHERE id=?
        """,
        (status, now if succeeded else None, error_category, now, record["id"]),
    )
    connection.execute(
        """
        INSERT INTO integration_audit_events (id, action, metadata_json, created_at)
        VALUES (?, ?, ?, ?)
        """,
        (
            str(uuid4()),
            (
                "medplum_org_connection_test_succeeded"
                if succeeded
                else "medplum_org_connection_test_failed"
            ),
            json.dumps(
                {
                    "organization_id": record["organization_id"],
                    "connection_id": record["id"],
                    "credential_source": record["credential_source"],
                    "status": status,
                    "safe_error_category": error_category,
                }
            ),
            now,
        ),
    )
