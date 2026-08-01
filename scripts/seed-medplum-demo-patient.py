from __future__ import annotations

import asyncio
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))


async def main() -> None:
    from api.main import connect, utc_now
    from api.medplum import MedplumError, create_medplum_service

    try:
        result = await create_medplum_service().seed_demo_panel()
    except MedplumError as error:
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
                  agent_id, physician_npi, medplum_practitioner_id, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?)
                ON CONFLICT(agent_id) DO UPDATE SET
                  medplum_practitioner_id=excluded.medplum_practitioner_id,
                  updated_at=excluded.updated_at
                """,
                (agent_id, npi, result["practitioners"][key], now, now),
            )
    print(f"Ethan Practitioner: {result['practitioners']['ethan']}")
    print(f"Lianne Practitioner: {result['practitioners']['lianne']}")
    for case_key, case in result["cases"].items():
        print(f"{case_key} Patient: {case['Patient']}")


if __name__ == "__main__":
    asyncio.run(main())
