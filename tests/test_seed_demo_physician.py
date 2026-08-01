from __future__ import annotations

import sqlite3
from pathlib import Path

from fastapi.testclient import TestClient

import api.main as api_main
from lamina_directory.seed_demo_physician import (
    DECLARED_EXPERTISE_TAGS,
    DEMO_AGENT_ID,
    DEMO_NPI,
    LIANNE_AGENT_ID,
    LIANNE_NPI,
    seed_demo_physician,
)


def create_database(path: Path) -> None:
    schema = Path(__file__).parents[1] / "sql" / "schema.sql"
    with sqlite3.connect(path) as connection:
        connection.executescript(schema.read_text(encoding="utf-8"))
        connection.execute(
            """
            INSERT INTO physicians (npi, display_name, primary_specialty, source)
            VALUES ('1234567890', 'Existing NPPES Physician, MD',
                    'Cardiology', 'NPPES')
            """
        )
        connection.execute(
            """
            INSERT INTO agents (id, physician_npi)
            VALUES ('agent-1234567890', '1234567890')
            """
        )


def test_seed_is_idempotent_and_preserves_nppes_physicians(tmp_path: Path) -> None:
    database = tmp_path / "lamina.sqlite"
    create_database(database)

    seed_demo_physician(database)
    seed_demo_physician(database)

    with sqlite3.connect(database) as connection:
        physician = connection.execute(
            """
            SELECT display_name, credential, primary_specialty, organization_name,
                   city, state, source, profile_status
            FROM physicians WHERE npi = ?
            """,
            (DEMO_NPI,),
        ).fetchone()
        agent = connection.execute(
            "SELECT id, status FROM agents WHERE physician_npi = ?", (DEMO_NPI,)
        ).fetchone()
        counts = connection.execute(
            """
            SELECT
              (SELECT COUNT(*) FROM physicians WHERE npi = ?),
              (SELECT COUNT(*) FROM agents WHERE physician_npi = ?),
              (SELECT COUNT(*) FROM physicians WHERE source = 'NPPES')
            """,
            (DEMO_NPI, DEMO_NPI),
        ).fetchone()
        configuration_count = connection.execute(
            "SELECT COUNT(*) FROM agent_configurations WHERE agent_id = ?",
            (DEMO_AGENT_ID,),
        ).fetchone()[0]
        lianne = connection.execute(
            """
            SELECT display_name, primary_specialty, source, profile_status
            FROM physicians WHERE npi = ?
            """,
            (LIANNE_NPI,),
        ).fetchone()
        lianne_agent = connection.execute(
            "SELECT id, status FROM agents WHERE physician_npi = ?", (LIANNE_NPI,)
        ).fetchone()

    assert physician == (
        "Ethan Bell, MD, MS",
        "MD, MS",
        "Internal Medicine",
        "Lamina Demo Medical Group",
        "San Francisco",
        "CA",
        "SYNTHETIC",
        "unclaimed",
    )
    assert agent == (DEMO_AGENT_ID, "reserved")
    assert counts == (1, 1, 1)
    assert configuration_count == 0
    assert lianne == ("Lianne Cha, MD", "Endocrinology", "SYNTHETIC", "unclaimed")
    assert lianne_agent == (LIANNE_AGENT_ID, "reserved")


def test_demo_verification_and_configuration_seed(
    tmp_path: Path, monkeypatch
) -> None:
    database = tmp_path / "lamina.sqlite"
    create_database(database)
    seed_demo_physician(database)
    monkeypatch.setattr(api_main, "DB_PATH", database)
    client = TestClient(api_main.app)

    claim = client.post(f"/physicians/{DEMO_NPI}/claims")
    assert claim.status_code == 200
    verified = client.post(f"/claims/{claim.json()['claim']['id']}/verify-demo")
    assert verified.status_code == 200

    configured = client.put(
        f"/agents/{DEMO_AGENT_ID}/configuration",
        json={"declared_expertise_tags": ["General Medicine"]},
    )
    assert configured.status_code == 200
    assert configured.json()["configuration"]["verified_specialties"] == [
        "Internal Medicine"
    ]

    seed_demo_physician(database)

    agent = client.get(f"/agents/{DEMO_AGENT_ID}").json()
    assert agent["status"] == "configuring"
    assert agent["claim"]["status"] == "verified"
    assert agent["configuration"]["verified_specialties"] == ["Internal Medicine"]
    assert agent["configuration"]["declared_expertise_tags"] == [
        "General Medicine",
        *DECLARED_EXPERTISE_TAGS,
    ]
