from __future__ import annotations

import sqlite3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "data" / "processed" / "lamina.sqlite"
SCHEMA = ROOT / "sql" / "schema.sql"

PHYSICIANS = [
    {
        "npi": "9000000001",
        "first_name": "Maya",
        "middle_name": "",
        "last_name": "Patel",
        "suffix": "",
        "credential": "MD",
        "display_name": "Maya Patel, MD",
        "primary_taxonomy_code": "207R00000X",
        "primary_specialty": "Internal Medicine Physician",
        "city": "San Francisco",
        "state": "CA",
    },
    {
        "npi": "9000000002",
        "first_name": "Amy",
        "middle_name": "",
        "last_name": "Chen",
        "suffix": "",
        "credential": "MD",
        "display_name": "Amy Chen, MD",
        "primary_taxonomy_code": "207RE0101X",
        "primary_specialty": "Endocrinology, Diabetes & Metabolism Physician",
        "city": "San Francisco",
        "state": "CA",
    },
    {
        "npi": "9000000003",
        "first_name": "Samuel",
        "middle_name": "",
        "last_name": "Ortiz",
        "suffix": "",
        "credential": "MD",
        "display_name": "Samuel Ortiz, MD",
        "primary_taxonomy_code": "207RC0000X",
        "primary_specialty": "Cardiovascular Disease Physician",
        "city": "Oakland",
        "state": "CA",
    },
    {
        "npi": "9000000004",
        "first_name": "Hana",
        "middle_name": "",
        "last_name": "Kim",
        "suffix": "",
        "credential": "DO",
        "display_name": "Hana Kim, DO",
        "primary_taxonomy_code": "207Q00000X",
        "primary_specialty": "Family Medicine Physician",
        "city": "Seattle",
        "state": "WA",
    },
    {
        "npi": "9000000005",
        "first_name": "Daniel",
        "middle_name": "",
        "last_name": "Lee",
        "suffix": "",
        "credential": "MD",
        "display_name": "Daniel Lee, MD",
        "primary_taxonomy_code": "207RN0300X",
        "primary_specialty": "Nephrology Physician",
        "city": "San Jose",
        "state": "CA",
    },
]


def main() -> None:
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    if OUTPUT.exists():
        OUTPUT.unlink()

    with sqlite3.connect(OUTPUT) as connection:
        connection.executescript(SCHEMA.read_text(encoding="utf-8"))
        for physician in PHYSICIANS:
            connection.execute(
                """
                INSERT INTO physicians (
                  npi, first_name, middle_name, last_name, suffix, credential,
                  display_name, primary_taxonomy_code, primary_specialty,
                  city, state, active, source, profile_status
                ) VALUES (
                  :npi, :first_name, :middle_name, :last_name, :suffix, :credential,
                  :display_name, :primary_taxonomy_code, :primary_specialty,
                  :city, :state, 1, 'SYNTHETIC', 'unclaimed'
                )
                """,
                physician,
            )
            connection.execute(
                """
                INSERT INTO agents (
                  id, physician_npi, status, claimed, public_posting_enabled
                ) VALUES (?, ?, 'reserved', 0, 0)
                """,
                (f"agent-{physician['npi']}", physician["npi"]),
            )
        connection.execute(
            """
            INSERT INTO physician_fts(npi, display_name, primary_specialty, city, state)
            SELECT npi, display_name, primary_specialty, city, state FROM physicians
            """
        )
        connection.commit()

    print(f"Created synthetic demo database: {OUTPUT}")
    print("Run: python -m uvicorn api.main:app --reload --port 8000")


if __name__ == "__main__":
    main()
