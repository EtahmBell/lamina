from __future__ import annotations

import argparse
import os
from pathlib import Path

from lamina_directory.reset_demo import report_as_json, reset_demo_database


def main() -> None:
    parser = argparse.ArgumentParser(description="Reset only Lamina synthetic demo workflow data.")
    parser.add_argument("--database", type=Path)
    parser.add_argument("--backup-directory", type=Path)
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args()
    database = args.database or Path(
        os.getenv("LAMINA_DB_PATH", "data/processed/lamina.sqlite")
    )
    report = reset_demo_database(database, args.backup_directory)
    if args.json:
        print(report_as_json(report))
        return
    print("Lamina demo reset")
    print("-----------------")
    print(f"Backup: {report.backup_path or 'not needed (already clean)'}")
    print(f"Forum posts removed: {len(report.targets.posts)}")
    print(f"Responses removed: {len(report.targets.responses)}")
    print(f"Drafts removed: {report.targets.drafts}")
    print(f"Monitoring runs removed: {len(report.targets.monitoring_runs)}")
    print(f"Generation records removed: {len(report.targets.generation_metadata)}")
    print(f"Medplum discussion links removed: {len(report.targets.forum_medplum_links)}")
    print(f"Grounding records removed: {len(report.targets.response_grounding)}")
    print(f"Workflow audit records removed: {len(report.targets.audit_events)}")
    print(f"NPPES physicians preserved: {report.nppes_count:,}")
    print("Ethan preserved: yes")
    print("Lianne preserved: yes")
    print("Medplum synthetic patients preserved: yes")
    print()
    print("READY FOR DEMO")


if __name__ == "__main__":
    main()
