from __future__ import annotations

import json
import sqlite3
from datetime import UTC, datetime
from pathlib import Path

DEMO_NPI = "9000000999"
DEMO_AGENT_ID = f"agent-{DEMO_NPI}"
LIANNE_NPI = "9000001000"
LIANNE_AGENT_ID = f"agent-{LIANNE_NPI}"
DECLARED_EXPERTISE_TAGS = [
    "Agentic Medicine",
    "Clinical Vibes",
    "Bedside Manner Informatics",
]


def ensure_organization_column(connection: sqlite3.Connection) -> None:
    columns = {row[1] for row in connection.execute("PRAGMA table_info(physicians)")}
    if "organization_name" not in columns:
        connection.execute("ALTER TABLE physicians ADD COLUMN organization_name TEXT")


def merge_declared_expertise_tags(connection: sqlite3.Connection) -> None:
    row = connection.execute(
        "SELECT declared_expertise_tags_json FROM agent_configurations WHERE agent_id = ?",
        (DEMO_AGENT_ID,),
    ).fetchone()
    if row is None:
        return

    tags = json.loads(row[0])
    seen = {tag.casefold() for tag in tags}
    for tag in DECLARED_EXPERTISE_TAGS:
        if tag.casefold() not in seen:
            tags.append(tag)
            seen.add(tag.casefold())
    connection.execute(
        """
        UPDATE agent_configurations
        SET declared_expertise_tags_json = ?, updated_at = ?
        WHERE agent_id = ?
        """,
        (json.dumps(tags), datetime.now(UTC).isoformat(), DEMO_AGENT_ID),
    )


def seed_demo_physician(database: Path) -> None:
    if not database.exists():
        raise FileNotFoundError(
            f"Lamina database not found at {database}. Build the NPPES directory first."
        )

    with sqlite3.connect(database) as connection:
        connection.execute("PRAGMA foreign_keys = ON")
        ensure_organization_column(connection)
        physicians = [
            (
                DEMO_NPI,
                "Ethan",
                "Bell",
                "MD, MS",
                "Ethan Bell, MD, MS",
                "207R00000X",
                "Internal Medicine",
            ),
            (
                LIANNE_NPI,
                "Lianne",
                "Cha",
                "MD",
                "Lianne Cha, MD",
                "207RE0101X",
                "Endocrinology",
            ),
        ]
        connection.executemany(
            """
            INSERT INTO physicians (
              npi, first_name, middle_name, last_name, suffix, credential,
              display_name, primary_taxonomy_code, primary_specialty,
              organization_name, city, state, active, source, profile_status
            ) VALUES (?, ?, '', ?, '', ?, ?, ?, ?, 'Lamina Demo Medical Group',
                      'San Francisco', 'CA', 1, 'SYNTHETIC', 'unclaimed')
            ON CONFLICT(npi) DO UPDATE SET
              first_name=excluded.first_name,
              middle_name=excluded.middle_name,
              last_name=excluded.last_name,
              suffix=excluded.suffix,
              credential=excluded.credential,
              display_name=excluded.display_name,
              primary_taxonomy_code=excluded.primary_taxonomy_code,
              primary_specialty=excluded.primary_specialty,
              organization_name=excluded.organization_name,
              city=excluded.city,
              state=excluded.state,
              active=excluded.active,
              source=excluded.source
            """,
            physicians,
        )
        connection.executemany(
            """
            INSERT INTO agents (id, physician_npi, status, claimed, public_posting_enabled)
            VALUES (?, ?, 'reserved', 0, 0)
            ON CONFLICT(id) DO NOTHING
            """,
            ((DEMO_AGENT_ID, DEMO_NPI), (LIANNE_AGENT_ID, LIANNE_NPI)),
        )
        for npi, _, _, _, display_name, _, specialty in physicians:
            connection.execute(
                """
                UPDATE physician_fts
                SET display_name=?, primary_specialty=?, city='San Francisco', state='CA'
                WHERE npi=?
                """,
                (display_name, specialty, npi),
            )
            connection.execute(
                """
                INSERT INTO physician_fts(npi, display_name, primary_specialty, city, state)
                SELECT ?, ?, ?, 'San Francisco', 'CA'
                WHERE NOT EXISTS (SELECT 1 FROM physician_fts WHERE npi = ?)
                """,
                (npi, display_name, specialty, npi),
            )
        merge_declared_expertise_tags(connection)
