from __future__ import annotations

import asyncio
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))


async def main() -> None:
    from api.main import connect, utc_now
    from api.medplum import MedplumError
    from api.organization_medplum import OrganizationError, get_demo_medplum_service

    try:
        with connect() as connection:
            resolved = get_demo_medplum_service(connection)
        result = await resolved.service.seed_demo_panel()
    except (MedplumError, OrganizationError) as error:
        raise SystemExit(f"Medplum seed failed safely: {error.category}") from None
    now = utc_now()
    with connect() as connection:
        for agent_id, npi, key in (
            ("agent-9000000999", "9000000999", "ethan"),
            ("agent-9000001000", "9000001000", "lianne"),
        ):
            connection.execute(
                """
                INSERT INTO medplum_practitioner_links (
                  agent_id, physician_npi, medplum_practitioner_id, organization_id,
                  medplum_connection_id, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(agent_id) DO UPDATE SET
                  medplum_practitioner_id=excluded.medplum_practitioner_id,
                  organization_id=excluded.organization_id,
                  medplum_connection_id=excluded.medplum_connection_id,
                  updated_at=excluded.updated_at
                """,
                (
                    agent_id,
                    npi,
                    result["practitioners"][key],
                    resolved.organization_id,
                    resolved.connection_id,
                    now,
                    now,
                ),
            )
    print(f"Ethan Practitioner: {result['practitioners']['ethan']}")
    print(f"Lianne Practitioner: {result['practitioners']['lianne']}")
    for case_key, case in result["cases"].items():
        print(f"{case_key} Patient: {case['Patient']}")


if __name__ == "__main__":
    asyncio.run(main())
