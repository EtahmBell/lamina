from __future__ import annotations

import json
import sqlite3
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

DEMO_NPIS = ("9000000999", "9000001000")
DEMO_AGENT_IDS = ("agent-9000000999", "agent-9000001000")
DEMO_ORGANIZATION_ID = "org-lamina-demo-medical-group"

BACKUP_TABLES = (
    "response_grounding",
    "monitoring_runs",
    "generation_metadata",
    "forum_medplum_links",
    "forum_responses",
    "forum_posts",
    "agent_audit_events",
)

WORKFLOW_AUDIT_ACTION_PREFIXES = (
    "monitoring_",
    "post_",
    "response_",
    "medplum_post_generation_",
    "medplum_export_",
)


class DemoResetError(RuntimeError):
    pass


@dataclass(frozen=True)
class ResetTargets:
    posts: tuple[str, ...]
    responses: tuple[str, ...]
    monitoring_runs: tuple[str, ...]
    generation_metadata: tuple[str, ...]
    forum_medplum_links: tuple[str, ...]
    response_grounding: tuple[str, ...]
    audit_events: tuple[str, ...]
    drafts: int

    @property
    def total(self) -> int:
        return sum(
            len(items)
            for items in (
                self.posts,
                self.responses,
                self.monitoring_runs,
                self.generation_metadata,
                self.forum_medplum_links,
                self.response_grounding,
                self.audit_events,
            )
        )


@dataclass(frozen=True)
class ResetReport:
    backup_path: Path | None
    targets: ResetTargets
    nppes_count: int
    synthetic_patients_preserved: bool


def _ids(connection: sqlite3.Connection, query: str, params: tuple[Any, ...]) -> tuple[str, ...]:
    return tuple(row[0] for row in connection.execute(query, params))


def _placeholders(values: tuple[str, ...]) -> str:
    return ",".join("?" for _ in values)


def discover_reset_targets(connection: sqlite3.Connection) -> ResetTargets:
    posts = _ids(
        connection,
        """
        SELECT id FROM forum_posts
        WHERE author_physician_npi IN (?, ?) OR author_agent_id IN (?, ?)
        ORDER BY id
        """,
        (*DEMO_NPIS, *DEMO_AGENT_IDS),
    )

    response_clauses = ["author_physician_npi IN (?, ?)", "author_agent_id IN (?, ?)"]
    response_params: list[Any] = [*DEMO_NPIS, *DEMO_AGENT_IDS]
    if posts:
        response_clauses.append(f"post_id IN ({_placeholders(posts)})")
        response_params.extend(posts)
    responses = _ids(
        connection,
        f"SELECT id FROM forum_responses WHERE {' OR '.join(response_clauses)} ORDER BY id",
        tuple(response_params),
    )

    run_clauses = ["agent_id IN (?, ?)"]
    run_params: list[Any] = [*DEMO_AGENT_IDS]
    if posts:
        run_clauses.append(f"post_id IN ({_placeholders(posts)})")
        run_params.extend(posts)
    if responses:
        run_clauses.append(f"response_id IN ({_placeholders(responses)})")
        run_params.extend(responses)
    monitoring_runs = _ids(
        connection,
        f"SELECT id FROM monitoring_runs WHERE {' OR '.join(run_clauses)} ORDER BY id",
        tuple(run_params),
    )

    generation_clauses: list[str] = []
    generation_params: list[Any] = []
    if posts:
        generation_clauses.append(
            f"(content_type='post' AND content_id IN ({_placeholders(posts)}))"
        )
        generation_params.extend(posts)
    if responses:
        generation_clauses.append(
            f"(content_type='response' AND content_id IN ({_placeholders(responses)}))"
        )
        generation_params.extend(responses)
    generation_metadata = (
        _ids(
            connection,
            f"SELECT id FROM generation_metadata WHERE {' OR '.join(generation_clauses)} ORDER BY id",
            tuple(generation_params),
        )
        if generation_clauses
        else ()
    )

    forum_medplum_links = (
        _ids(
            connection,
            f"SELECT id FROM forum_medplum_links WHERE post_id IN ({_placeholders(posts)}) ORDER BY id",
            posts,
        )
        if posts
        else ()
    )
    response_grounding = (
        _ids(
            connection,
            f"""
            SELECT response_id FROM response_grounding
            WHERE response_id IN ({_placeholders(responses)})
               OR monitoring_run_id IN ({_placeholders(monitoring_runs)})
            ORDER BY response_id
            """,
            (*responses, *monitoring_runs),
        )
        if responses and monitoring_runs
        else (
            _ids(
                connection,
                f"SELECT response_id FROM response_grounding WHERE response_id IN ({_placeholders(responses)}) ORDER BY response_id",
                responses,
            )
            if responses
            else ()
        )
    )

    audit_predicate = " OR ".join("action LIKE ?" for _ in WORKFLOW_AUDIT_ACTION_PREFIXES)
    audit_events = _ids(
        connection,
        f"""
        SELECT id FROM agent_audit_events
        WHERE agent_id IN (?, ?) AND ({audit_predicate})
        ORDER BY id
        """,
        (*DEMO_AGENT_IDS, *(f"{prefix}%" for prefix in WORKFLOW_AUDIT_ACTION_PREFIXES)),
    )
    drafts = connection.execute(
        f"""
        SELECT
          (SELECT count(*) FROM forum_posts
           WHERE id IN ({_placeholders(posts)}) AND status != 'published') +
          (SELECT count(*) FROM forum_responses
           WHERE id IN ({_placeholders(responses)}) AND status != 'published')
        """,
        (*posts, *responses),
    ).fetchone()[0] if posts and responses else sum(
        connection.execute(
            f"SELECT count(*) FROM {table} WHERE id IN ({_placeholders(ids)}) AND status != 'published'",
            ids,
        ).fetchone()[0]
        for table, ids in (("forum_posts", posts), ("forum_responses", responses))
        if ids
    )
    return ResetTargets(
        posts=posts,
        responses=responses,
        monitoring_runs=monitoring_runs,
        generation_metadata=generation_metadata,
        forum_medplum_links=forum_medplum_links,
        response_grounding=response_grounding,
        audit_events=audit_events,
        drafts=drafts,
    )


def _protected_snapshot(connection: sqlite3.Connection, targets: ResetTargets) -> dict[str, Any]:
    protected_queries = {
        "demo_physicians": (
            "SELECT * FROM physicians WHERE npi IN (?, ?) ORDER BY npi",
            DEMO_NPIS,
        ),
        "demo_agents": (
            "SELECT * FROM agents WHERE id IN (?, ?) ORDER BY id",
            DEMO_AGENT_IDS,
        ),
        "claims": (
            "SELECT * FROM profile_claims WHERE physician_npi IN (?, ?) ORDER BY id",
            DEMO_NPIS,
        ),
        "configurations": (
            "SELECT * FROM agent_configurations WHERE agent_id IN (?, ?) ORDER BY agent_id",
            DEMO_AGENT_IDS,
        ),
        "organizations": (
            "SELECT * FROM organizations WHERE id=? ORDER BY id",
            (DEMO_ORGANIZATION_ID,),
        ),
        "memberships": (
            "SELECT * FROM organization_members WHERE agent_id IN (?, ?) ORDER BY id",
            DEMO_AGENT_IDS,
        ),
        "medplum_connections": (
            "SELECT * FROM organization_medplum_connections WHERE organization_id=? ORDER BY id",
            (DEMO_ORGANIZATION_ID,),
        ),
        "practitioner_links": (
            "SELECT * FROM medplum_practitioner_links WHERE agent_id IN (?, ?) ORDER BY agent_id",
            DEMO_AGENT_IDS,
        ),
    }
    snapshot: dict[str, Any] = {
        name: tuple(tuple(row) for row in connection.execute(query, params))
        for name, (query, params) in protected_queries.items()
    }
    snapshot["nppes_count"] = connection.execute(
        "SELECT count(*) FROM physicians WHERE upper(source)='NPPES'"
    ).fetchone()[0]
    snapshot["physician_fts_count"] = connection.execute(
        "SELECT count(*) FROM physician_fts"
    ).fetchone()[0]
    for table, target_ids in (
        ("forum_posts", targets.posts),
        ("forum_responses", targets.responses),
        ("monitoring_runs", targets.monitoring_runs),
        ("generation_metadata", targets.generation_metadata),
        ("forum_medplum_links", targets.forum_medplum_links),
        ("response_grounding", targets.response_grounding),
        ("agent_audit_events", targets.audit_events),
    ):
        key = "response_id" if table == "response_grounding" else "id"
        if target_ids:
            rows = connection.execute(
                f"SELECT {key} FROM {table} WHERE {key} NOT IN ({_placeholders(target_ids)}) ORDER BY {key}",
                target_ids,
            )
        else:
            rows = connection.execute(f"SELECT {key} FROM {table} ORDER BY {key}")
        snapshot[f"unrelated_{table}"] = tuple(row[0] for row in rows)
    return snapshot


def _copy_rows(
    source: sqlite3.Connection,
    destination: sqlite3.Connection,
    table: str,
    identifiers: tuple[str, ...],
) -> None:
    schema = source.execute(
        "SELECT sql FROM sqlite_master WHERE type='table' AND name=?", (table,)
    ).fetchone()
    if schema is None or schema[0] is None:
        raise DemoResetError(f"required table is unavailable: {table}")
    destination.execute(schema[0])
    if not identifiers:
        return
    key = "response_id" if table == "response_grounding" else "id"
    cursor = source.execute(
        f"SELECT * FROM {table} WHERE {key} IN ({_placeholders(identifiers)}) ORDER BY {key}",
        identifiers,
    )
    rows = cursor.fetchall()
    if rows:
        destination.executemany(
            f"INSERT INTO {table} VALUES ({','.join('?' for _ in cursor.description)})",
            rows,
        )


def create_selective_backup(
    connection: sqlite3.Connection,
    database: Path,
    backup_directory: Path,
    targets: ResetTargets,
) -> Path:
    backup_directory.mkdir(parents=True, exist_ok=True)
    timestamp = datetime.now(UTC).strftime("%Y%m%d-%H%M%S-%f")
    backup_path = backup_directory / f"lamina-before-demo-reset-{timestamp}.sqlite"
    with sqlite3.connect(backup_path) as backup:
        backup.execute(
            """
            CREATE TABLE reset_backup_metadata (
              created_at TEXT NOT NULL,
              source_database TEXT NOT NULL,
              scope TEXT NOT NULL,
              nppes_rows_included INTEGER NOT NULL
            )
            """
        )
        backup.execute(
            "INSERT INTO reset_backup_metadata VALUES (?, ?, ?, 0)",
            (
                datetime.now(UTC).isoformat(),
                str(database.resolve()),
                "synthetic demo workflow rows scheduled for deletion",
            ),
        )
        identifiers = {
            "response_grounding": targets.response_grounding,
            "monitoring_runs": targets.monitoring_runs,
            "generation_metadata": targets.generation_metadata,
            "forum_medplum_links": targets.forum_medplum_links,
            "forum_responses": targets.responses,
            "forum_posts": targets.posts,
            "agent_audit_events": targets.audit_events,
        }
        for table in BACKUP_TABLES:
            _copy_rows(connection, backup, table, identifiers[table])
    return backup_path


def _delete_ids(
    connection: sqlite3.Connection,
    table: str,
    identifiers: tuple[str, ...],
) -> None:
    if not identifiers:
        return
    key = "response_id" if table == "response_grounding" else "id"
    connection.execute(
        f"DELETE FROM {table} WHERE {key} IN ({_placeholders(identifiers)})",
        identifiers,
    )


def reset_demo_database(database: Path, backup_directory: Path | None = None) -> ResetReport:
    database = database.resolve()
    if not database.is_file():
        raise DemoResetError(f"database does not exist: {database}")
    backup_directory = backup_directory or database.parent / "backups"
    with sqlite3.connect(database) as connection:
        connection.execute("PRAGMA foreign_keys=ON")
        targets = discover_reset_targets(connection)
        before = _protected_snapshot(connection, targets)
        if len(before["demo_physicians"]) != 2 or len(before["demo_agents"]) != 2:
            raise DemoResetError("Ethan and Lianne preservation check failed")
        backup_path = (
            create_selective_backup(connection, database, backup_directory, targets)
            if targets.total
            else None
        )
        try:
            connection.execute("BEGIN IMMEDIATE")
            for table, identifiers in (
                ("response_grounding", targets.response_grounding),
                ("monitoring_runs", targets.monitoring_runs),
                ("generation_metadata", targets.generation_metadata),
                ("forum_medplum_links", targets.forum_medplum_links),
                ("forum_responses", targets.responses),
                ("forum_posts", targets.posts),
                ("agent_audit_events", targets.audit_events),
            ):
                _delete_ids(connection, table, identifiers)
            after = _protected_snapshot(connection, ResetTargets((), (), (), (), (), (), (), 0))
            for key, value in before.items():
                if key.startswith("unrelated_"):
                    continue
                if after[key] != value:
                    raise DemoResetError(f"protected state changed: {key}")
            for key, value in before.items():
                if key.startswith("unrelated_") and after[key] != value:
                    raise DemoResetError(f"unrelated application state changed: {key}")
            connection.commit()
        except Exception:
            connection.rollback()
            raise
        return ResetReport(
            backup_path=backup_path,
            targets=targets,
            nppes_count=before["nppes_count"],
            synthetic_patients_preserved=bool(before["practitioner_links"]),
        )


def report_as_json(report: ResetReport) -> str:
    return json.dumps(
        {
            "backup_path": str(report.backup_path) if report.backup_path else None,
            "forum_posts_removed": len(report.targets.posts),
            "responses_removed": len(report.targets.responses),
            "drafts_removed": report.targets.drafts,
            "monitoring_runs_removed": len(report.targets.monitoring_runs),
            "generation_records_removed": len(report.targets.generation_metadata),
            "medplum_export_links_removed": len(report.targets.forum_medplum_links),
            "grounding_records_removed": len(report.targets.response_grounding),
            "workflow_audit_records_removed": len(report.targets.audit_events),
            "nppes_count": report.nppes_count,
            "ethan_preserved": True,
            "lianne_preserved": True,
            "medplum_synthetic_patients_preserved": report.synthetic_patients_preserved,
        }
    )
