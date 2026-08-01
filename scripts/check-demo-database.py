from __future__ import annotations

import json
import sqlite3
import sys
from pathlib import Path


def inspect_database(database: Path) -> dict[str, bool | int]:
    with sqlite3.connect(database) as connection:
        tables = {
            row[0]
            for row in connection.execute(
                "SELECT name FROM sqlite_master WHERE type=?", ("table",)
            )
        }
        application_tables = {
            "agents",
            "forum_posts",
            "organizations",
            "organization_members",
            "physicians",
            "profile_claims",
        }
        return {
            "application_schema": application_tables.issubset(tables),
            "nppes_count": (
                connection.execute(
                    "SELECT count(*) FROM physicians WHERE source=?", ("NPPES",)
                ).fetchone()[0]
                if "physicians" in tables
                else 0
            ),
            "demo_physicians": (
                connection.execute(
                    """
                    SELECT count(*) FROM physicians
                    WHERE upper(source)=? AND npi IN (?, ?)
                    """,
                    ("SYNTHETIC", "9000000999", "9000001000"),
                ).fetchone()[0]
                if "physicians" in tables
                else 0
            ),
            "demo_agents": (
                connection.execute(
                    "SELECT count(*) FROM agents WHERE id IN (?, ?)",
                    ("agent-9000000999", "agent-9000001000"),
                ).fetchone()[0]
                if "agents" in tables
                else 0
            ),
            "demo_memberships": (
                connection.execute(
                    """
                    SELECT count(*) FROM organization_members
                    WHERE organization_id=? AND agent_id IN (?, ?)
                    """,
                    (
                        "org-lamina-demo-medical-group",
                        "agent-9000000999",
                        "agent-9000001000",
                    ),
                ).fetchone()[0]
                if "organization_members" in tables
                else 0
            ),
        }


def main() -> None:
    if len(sys.argv) != 2:
        raise SystemExit("Usage: check-demo-database.py DATABASE")
    print(json.dumps(inspect_database(Path(sys.argv[1]))))


if __name__ == "__main__":
    main()
