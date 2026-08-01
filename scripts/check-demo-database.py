from __future__ import annotations

import json
import sqlite3
import sys
from pathlib import Path


def inspect_database(database: Path) -> dict[str, bool | int | dict[str, str]]:
    with sqlite3.connect(database) as connection:
        tables = {
            row[0]
            for row in connection.execute(
                "SELECT name FROM sqlite_master WHERE type=?", ("table",)
            )
        }
        application_tables = {
            "agents",
            "agent_configurations",
            "forum_posts",
            "forum_responses",
            "medplum_practitioner_links",
            "monitoring_runs",
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
            "demo_agent_statuses": (
                {
                    row[0]: row[1]
                    for row in connection.execute(
                        "SELECT id, status FROM agents WHERE id IN (?, ?) ORDER BY id",
                        ("agent-9000000999", "agent-9000001000"),
                    )
                }
                if "agents" in tables
                else {}
            ),
            "demo_configurations": (
                connection.execute(
                    "SELECT count(*) FROM agent_configurations WHERE agent_id IN (?, ?)",
                    ("agent-9000000999", "agent-9000001000"),
                ).fetchone()[0]
                if "agent_configurations" in tables
                else 0
            ),
            "medplum_practitioner_mappings": (
                connection.execute(
                    "SELECT count(*) FROM medplum_practitioner_links WHERE agent_id IN (?, ?)",
                    ("agent-9000000999", "agent-9000001000"),
                ).fetchone()[0]
                if "medplum_practitioner_links" in tables
                else 0
            ),
            "published_posts": (
                connection.execute(
                    "SELECT count(*) FROM forum_posts WHERE status='published'"
                ).fetchone()[0]
                if "forum_posts" in tables
                else 0
            ),
            "pending_posts": (
                connection.execute(
                    "SELECT count(*) FROM forum_posts WHERE status IN ('draft', 'awaiting_physician_approval')"
                ).fetchone()[0]
                if "forum_posts" in tables
                else 0
            ),
            "pending_responses": (
                connection.execute(
                    "SELECT count(*) FROM forum_responses WHERE status IN ('draft', 'awaiting_physician_approval')"
                ).fetchone()[0]
                if "forum_responses" in tables
                else 0
            ),
            "monitoring_runs": (
                connection.execute("SELECT count(*) FROM monitoring_runs").fetchone()[0]
                if "monitoring_runs" in tables
                else 0
            ),
        }


def main() -> None:
    if len(sys.argv) != 2:
        raise SystemExit("Usage: check-demo-database.py DATABASE")
    print(json.dumps(inspect_database(Path(sys.argv[1]))))


if __name__ == "__main__":
    main()
