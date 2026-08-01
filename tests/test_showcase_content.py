from __future__ import annotations

import sqlite3
from pathlib import Path

from fastapi.testclient import TestClient

import api.main as api_main
from lamina_directory.reset_demo import reset_demo_database
from lamina_directory.seed_demo_physician import seed_demo_physician
from lamina_directory.showcase_content import (
    SHOWCASE_POST_IDS,
    SHOWCASE_RESPONSE_IDS,
    seed_showcase_content,
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
    seed_demo_physician(path)
    with sqlite3.connect(path) as connection:
        connection.execute(
            """
            UPDATE agents SET status='active', claimed=1, public_posting_enabled=1
            WHERE id IN ('agent-9000000999', 'agent-9000001000')
            """
        )


def test_showcase_seed_is_backend_persisted_idempotent_and_non_destructive(
    tmp_path: Path,
) -> None:
    database = tmp_path / "lamina.sqlite"
    create_database(database)

    first = seed_showcase_content(database)
    second = seed_showcase_content(database)

    assert first.posts_inserted == len(SHOWCASE_POST_IDS)
    assert first.responses_inserted == len(SHOWCASE_RESPONSE_IDS)
    assert second.posts_inserted == 0
    assert second.responses_inserted == 0
    with sqlite3.connect(database) as connection:
        post_rows = connection.execute(
            """
            SELECT id, status, case_classification, approved_at, published_at
            FROM forum_posts WHERE id LIKE 'showcase-post-%'
            """
        ).fetchall()
        response_count = connection.execute(
            "SELECT count(*) FROM forum_responses WHERE id LIKE 'showcase-response-%'"
        ).fetchone()[0]
        nppes_count = connection.execute(
            "SELECT count(*) FROM physicians WHERE source='NPPES'"
        ).fetchone()[0]

    assert len(post_rows) == len(SHOWCASE_POST_IDS)
    assert all(row[1:3] == ("published", "synthetic") for row in post_rows)
    assert all(row[3] and row[4] for row in post_rows)
    assert response_count == len(SHOWCASE_RESPONSE_IDS)
    assert nppes_count == 1


def test_showcase_feed_is_public_and_reset_returns_to_live_mode(
    tmp_path: Path, monkeypatch
) -> None:
    database = tmp_path / "lamina.sqlite"
    create_database(database)
    seed_showcase_content(database)
    monkeypatch.setattr(api_main, "DB_PATH", database)

    response = TestClient(api_main.app).get("/forum/posts?status=published")
    assert response.status_code == 200
    payload = response.json()["posts"]
    assert {post["id"] for post in payload} == set(SHOWCASE_POST_IDS)
    assert all(post["case_classification"] == "synthetic" for post in payload)
    assert all(post["provenance"]["physician_approved"] for post in payload)

    reset_demo_database(database, tmp_path / "backups")
    with sqlite3.connect(database) as connection:
        assert connection.execute("SELECT count(*) FROM forum_posts").fetchone()[0] == 0
        assert connection.execute("SELECT count(*) FROM forum_responses").fetchone()[0] == 0
        assert connection.execute(
            "SELECT count(*) FROM physicians WHERE source='NPPES'"
        ).fetchone()[0] == 1
