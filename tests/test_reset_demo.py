from __future__ import annotations

import sqlite3
from pathlib import Path

from lamina_directory.reset_demo import reset_demo_database

DEMO_NPIS = ("9000000999", "9000001000")
DEMO_AGENTS = ("agent-9000000999", "agent-9000001000")


def _create_database(path: Path) -> None:
    schema = Path("sql/schema.sql").read_text(encoding="utf-8")
    with sqlite3.connect(path) as connection:
        connection.executescript(schema)
        physicians = [
            ("9000000999", "Ethan Bell, MD, MS", "synthetic", "Internal Medicine"),
            ("9000001000", "Lianne Cha, MD", "synthetic", "Endocrinology"),
            ("1234567890", "Unrelated NPPES Physician", "NPPES", "Family Medicine"),
            ("9000002000", "Other Synthetic Physician", "synthetic", "Neurology"),
        ]
        connection.executemany(
            """
            INSERT INTO physicians
              (npi, display_name, source, primary_specialty, profile_status)
            VALUES (?, ?, ?, ?, 'claimed')
            """,
            physicians,
        )
        connection.executemany(
            "INSERT INTO physician_fts (npi, display_name, primary_specialty) VALUES (?, ?, ?)",
            [(npi, name, specialty) for npi, name, _source, specialty in physicians],
        )
        agents = [
            (DEMO_AGENTS[0], DEMO_NPIS[0]),
            (DEMO_AGENTS[1], DEMO_NPIS[1]),
            ("agent-other", "9000002000"),
        ]
        connection.executemany(
            """
            INSERT INTO agents
              (id, physician_npi, status, claimed, public_posting_enabled)
            VALUES (?, ?, 'active', 1, 1)
            """,
            agents,
        )
        for agent_id, npi in agents:
            connection.execute(
                """
                INSERT INTO agent_configurations VALUES
                  (?, '["Internal Medicine"]', '[]', '[]', 1, 1, 1, 1,
                   'requires_physician_approval', 'none', '[]', 'network', 'brief',
                   '{}', '2026-01-01', '2026-01-01')
                """,
                (agent_id,),
            )
            connection.execute(
                """
                INSERT INTO profile_claims VALUES
                  (?, ?, ?, 'verified', 'demo', '2026-01-01', '2026-01-01',
                   '2026-01-01', '2026-01-01')
                """,
                (f"claim-{npi}", npi, agent_id),
            )
        connection.execute(
            """
            INSERT INTO organizations VALUES
              ('org-lamina-demo-medical-group', 'Lamina Demo Medical Group',
               'lamina-demo-medical-group', 'active', '2026-01-01', '2026-01-01')
            """
        )
        for agent_id, npi in agents[:2]:
            connection.execute(
                """
                INSERT INTO organization_members VALUES
                  (?, 'org-lamina-demo-medical-group', ?, ?, 'physician', 'active',
                   '2026-01-01', '2026-01-01')
                """,
                (f"member-{npi}", npi, agent_id),
            )
        connection.execute(
            """
            INSERT INTO organization_medplum_connections VALUES
              ('medplum-demo', 'org-lamina-demo-medical-group', 'medplum',
               'https://example.test', 'https://example.test/oauth',
               'https://example.test/fhir/R4', 'project', 'environment',
               'DEFAULT_MEDPLUM', 'connected', '2026-01-01', NULL,
               '2026-01-01', '2026-01-01')
            """
        )
        for agent_id, npi in agents[:2]:
            connection.execute(
                """
                INSERT INTO medplum_practitioner_links VALUES
                  (?, ?, ?, 'org-lamina-demo-medical-group', 'medplum-demo',
                   '2026-01-01', '2026-01-01')
                """,
                (agent_id, npi, f"practitioner-{npi}"),
            )

        for post_id, agent_id, npi in (
            ("demo-post", DEMO_AGENTS[0], DEMO_NPIS[0]),
            ("other-post", "agent-other", "9000002000"),
        ):
            connection.execute(
                """
                INSERT INTO forum_posts VALUES
                  (?, ?, ?, 'Title', 'Question', 'Context', '[]', 'synthetic',
                   'published', 'agent_generated', '2026-01-01', '2026-01-01',
                   '2026-01-01', '2026-01-01', NULL)
                """,
                (post_id, agent_id, npi),
            )
        for response_id, post_id, agent_id, npi in (
            ("demo-response", "demo-post", DEMO_AGENTS[1], DEMO_NPIS[1]),
            ("other-response", "other-post", "agent-other", "9000002000"),
        ):
            connection.execute(
                """
                INSERT INTO forum_responses VALUES
                  (?, ?, ?, ?, 'clinical_consideration', 'Headline', 'Content', '[]',
                   'published', 'agent_generated', '2026-01-01', '2026-01-01',
                   '2026-01-01', '2026-01-01', NULL)
                """,
                (response_id, post_id, agent_id, npi),
            )
        connection.execute(
            """
            INSERT INTO generation_metadata VALUES
              ('demo-generation', 'post', 'demo-post', ?, ?, 'v1', 'model', NULL,
               '2026-01-01')
            """,
            (DEMO_AGENTS[0], DEMO_NPIS[0]),
        )
        connection.execute(
            """
            INSERT INTO forum_medplum_links VALUES
              ('demo-link', 'demo-post', 'patient-secret', '[]', '[]', '[]',
               'medplum_synthetic_patient', ?, 'org-lamina-demo-medical-group',
               'medplum-demo', '2026-01-01', '2026-01-01', 'communication-id',
               '2026-01-01')
            """,
            (DEMO_AGENTS[0],),
        )
        connection.execute(
            """
            INSERT INTO monitoring_runs VALUES
              ('demo-run', 'demo-post', ?, 'completed', 1, '[]', 'draft_created', 1,
               'demo-response', 'v1', 'model', '[]', '2026-01-01', '2026-01-01', NULL)
            """,
            (DEMO_AGENTS[1],),
        )
        connection.execute(
            """
            INSERT INTO response_grounding VALUES
              ('demo-response', 'medplum_case_match', 'medplum', 1, '["case-1"]',
               'demo-run', 'Relevant', '[]', '[]', '[]', '[]', '[]', '2026-01-01')
            """
        )
        connection.execute(
            """
            INSERT INTO agent_audit_events VALUES
              ('workflow-audit', ?, ?, 'agent_runtime', 'monitoring_started', '{}',
               '2026-01-01')
            """,
            (DEMO_AGENTS[1], DEMO_NPIS[1]),
        )
        connection.execute(
            """
            INSERT INTO agent_audit_events VALUES
              ('lifecycle-audit', ?, ?, 'physician', 'agent_activated', '{}',
               '2026-01-01')
            """,
            (DEMO_AGENTS[1], DEMO_NPIS[1]),
        )


def _rows(connection: sqlite3.Connection, table: str) -> set[str]:
    key = "response_id" if table == "response_grounding" else "id"
    return {row[0] for row in connection.execute(f"SELECT {key} FROM {table}")}


def test_reset_removes_only_demo_workflow_and_creates_selective_backup(tmp_path: Path) -> None:
    database = tmp_path / "lamina.sqlite"
    backups = tmp_path / "backups"
    _create_database(database)

    report = reset_demo_database(database, backups)

    assert len(report.targets.posts) == 1
    assert len(report.targets.responses) == 1
    assert len(report.targets.monitoring_runs) == 1
    assert report.backup_path is not None
    assert report.backup_path.parent == backups
    with sqlite3.connect(report.backup_path) as backup:
        assert _rows(backup, "forum_posts") == {"demo-post"}
        assert _rows(backup, "forum_responses") == {"demo-response"}
        assert backup.execute(
            "SELECT nppes_rows_included FROM reset_backup_metadata"
        ).fetchone()[0] == 0
        assert backup.execute(
            "SELECT count(*) FROM sqlite_master WHERE type='table' AND name='physicians'"
        ).fetchone()[0] == 0

    with sqlite3.connect(database) as connection:
        assert _rows(connection, "forum_posts") == {"other-post"}
        assert _rows(connection, "forum_responses") == {"other-response"}
        assert _rows(connection, "monitoring_runs") == set()
        assert _rows(connection, "response_grounding") == set()
        assert _rows(connection, "forum_medplum_links") == set()
        assert _rows(connection, "generation_metadata") == set()
        assert _rows(connection, "agent_audit_events") == {"lifecycle-audit"}
        assert connection.execute(
            "SELECT count(*) FROM physicians WHERE npi IN (?, ?)", DEMO_NPIS
        ).fetchone()[0] == 2
        assert connection.execute(
            "SELECT count(*) FROM agents WHERE id IN (?, ?) AND status='active'",
            DEMO_AGENTS,
        ).fetchone()[0] == 2
        assert connection.execute("SELECT count(*) FROM agent_configurations").fetchone()[0] == 3
        assert connection.execute("SELECT count(*) FROM organizations").fetchone()[0] == 1
        assert connection.execute("SELECT count(*) FROM organization_members").fetchone()[0] == 2
        assert connection.execute("SELECT count(*) FROM medplum_practitioner_links").fetchone()[0] == 2
        assert connection.execute(
            "SELECT count(*) FROM physicians WHERE source='NPPES'"
        ).fetchone()[0] == 1
        assert connection.execute(
            "SELECT npi FROM physician_fts WHERE physician_fts MATCH 'Unrelated'"
        ).fetchone()[0] == "1234567890"


def test_reset_is_idempotent(tmp_path: Path) -> None:
    database = tmp_path / "lamina.sqlite"
    backups = tmp_path / "backups"
    _create_database(database)
    reset_demo_database(database, backups)

    second = reset_demo_database(database, backups)

    assert second.targets.total == 0
    assert second.backup_path is None
    assert len(list(backups.glob("*.sqlite"))) == 1
