from __future__ import annotations

import argparse
import json
import sqlite3
import zipfile
from collections.abc import Iterator
from pathlib import Path

import pandas as pd

from .common import build_display_name, clean_text, ensure_parent

ENTITY_TYPE = "Entity Type Code"
NPI = "NPI"
FIRST = "Provider First Name"
MIDDLE = "Provider Middle Name"
LAST = "Provider Last Name (Legal Name)"
SUFFIX = "Provider Name Suffix Text"
CREDENTIAL = "Provider Credential Text"
ADDRESS_1 = "Provider First Line Business Practice Location Address"
ADDRESS_2 = "Provider Second Line Business Practice Location Address"
CITY = "Provider Business Practice Location Address City Name"
STATE = "Provider Business Practice Location Address State Name"
ZIP_CODE = "Provider Business Practice Location Address Postal Code"
COUNTRY = "Provider Business Practice Location Address Country Code (If outside U.S.)"
PHONE = "Provider Business Practice Location Address Telephone Number"
ENUMERATION_DATE = "Provider Enumeration Date"
LAST_UPDATED = "Last Update Date"
DEACTIVATION_DATE = "NPI Deactivation Date"
REACTIVATION_DATE = "NPI Reactivation Date"


def taxonomy_code_columns(columns: list[str]) -> list[str]:
    return sorted(
        [column for column in columns if column.startswith("Healthcare Provider Taxonomy Code_")],
        key=lambda value: int(value.rsplit("_", 1)[1]),
    )


def taxonomy_switch_columns(columns: list[str]) -> list[str]:
    return sorted(
        [
            column
            for column in columns
            if column.startswith("Healthcare Provider Primary Taxonomy Switch_")
        ],
        key=lambda value: int(value.rsplit("_", 1)[1]),
    )


def load_physician_taxonomies(path: Path) -> tuple[set[str], dict[str, str]]:
    taxonomy = pd.read_csv(path, dtype=str).fillna("")
    normalized = {column.strip().lower(): column for column in taxonomy.columns}

    code_col = normalized.get("code")
    grouping_col = normalized.get("grouping")
    display_col = normalized.get("display name")
    classification_col = normalized.get("classification")
    specialization_col = normalized.get("specialization")
    if not code_col or not grouping_col:
        raise ValueError(f"Unexpected NUCC columns: {list(taxonomy.columns)}")

    physician_rows = taxonomy[
        taxonomy[grouping_col].str.strip().eq("Allopathic & Osteopathic Physicians")
    ].copy()
    codes = set(physician_rows[code_col].str.strip())

    def display(row: pd.Series) -> str:
        if display_col and clean_text(row[display_col]):
            return clean_text(row[display_col]) or "Physician"
        parts = []
        if specialization_col and clean_text(row[specialization_col]):
            parts.append(clean_text(row[specialization_col]))
        if classification_col and clean_text(row[classification_col]):
            parts.append(clean_text(row[classification_col]))
        return " — ".join(part for part in parts if part) or "Physician"

    labels = {str(row[code_col]).strip(): display(row) for _, row in physician_rows.iterrows()}
    return codes, labels


def find_main_csv_in_zip(path: Path) -> str:
    """Return the full NPPES provider CSV, not its header companion."""
    with zipfile.ZipFile(path) as archive:
        candidates = [
            info
            for info in archive.infolist()
            if Path(info.filename).name.lower().startswith("npidata_pfile_")
            and info.filename.lower().endswith(".csv")
            and "fileheader" not in Path(info.filename).name.lower()
        ]

    if not candidates:
        raise RuntimeError(
            "Could not find the full npidata_pfile_*.csv in the NPPES ZIP."
        )

    # The actual provider file is much larger than any companion CSV.
    return max(candidates, key=lambda info: info.file_size).filename


def read_header(source: Path) -> list[str]:
    if source.suffix.lower() == ".zip":
        member = find_main_csv_in_zip(source)
        with zipfile.ZipFile(source) as archive, archive.open(member) as handle:
            return list(pd.read_csv(handle, nrows=0, dtype=str).columns)
    return list(pd.read_csv(source, nrows=0, dtype=str).columns)


def chunk_reader(source: Path, usecols: list[str], chunksize: int) -> Iterator[pd.DataFrame]:
    kwargs = {
        "dtype": str,
        "usecols": usecols,
        "chunksize": chunksize,
        "low_memory": False,
        "keep_default_na": False,
        "na_filter": False,
    }
    if source.suffix.lower() == ".zip":
        member = find_main_csv_in_zip(source)
        archive = zipfile.ZipFile(source)
        handle = archive.open(member)
        try:
            yield from pd.read_csv(handle, **kwargs)
        finally:
            handle.close()
            archive.close()
    else:
        yield from pd.read_csv(source, **kwargs)


def active_mask(frame: pd.DataFrame) -> pd.Series:
    if DEACTIVATION_DATE not in frame.columns:
        return pd.Series(True, index=frame.index)
    deactivation_raw = frame[DEACTIVATION_DATE].str.strip()
    deactivated = deactivation_raw.ne("")
    if REACTIVATION_DATE not in frame.columns:
        return ~deactivated
    reactivation_raw = frame[REACTIVATION_DATE].str.strip()
    deactivation_date = pd.to_datetime(deactivation_raw, errors="coerce")
    reactivation_date = pd.to_datetime(reactivation_raw, errors="coerce")
    return ~deactivated | (reactivation_date.notna() & (reactivation_date >= deactivation_date))


def initialize_database(connection: sqlite3.Connection, schema_path: Path) -> None:
    connection.executescript(schema_path.read_text(encoding="utf-8"))
    connection.execute("DELETE FROM physician_fts")
    connection.execute("DELETE FROM agents")
    connection.execute("DELETE FROM physicians")
    connection.commit()


def transform_chunk(
    frame: pd.DataFrame,
    physician_codes: set[str],
    taxonomy_labels: dict[str, str],
    tax_cols: list[str],
    switch_cols: list[str],
    state_filter: set[str] | None,
) -> pd.DataFrame:
    frame = frame[frame[ENTITY_TYPE].astype(str).str.strip().eq("1")]
    frame = frame[active_mask(frame)]
    if state_filter:
        frame = frame[frame[STATE].str.upper().isin(state_filter)]
    if frame.empty:
        return frame

    tax = frame[tax_cols].apply(lambda column: column.str.strip())
    physician_tax = tax.where(tax.isin(physician_codes))
    has_physician_tax = physician_tax.notna().any(axis=1)
    frame = frame[has_physician_tax].copy()
    physician_tax = physician_tax.loc[has_physician_tax]
    if frame.empty:
        return frame

    primary = pd.Series(index=frame.index, dtype="object")
    if switch_cols and len(switch_cols) == len(tax_cols):
        switches = frame[switch_cols].apply(lambda column: column.str.strip().str.upper())
        switches.columns = tax_cols
        primary_candidates = physician_tax.where(switches.eq("Y"))
        primary = primary_candidates.bfill(axis=1).iloc[:, 0]
    fallback = physician_tax.bfill(axis=1).iloc[:, 0]
    primary = primary.fillna(fallback)

    out = pd.DataFrame(index=frame.index)
    out["npi"] = frame[NPI].str.strip()
    out["first_name"] = frame[FIRST].str.strip()
    out["middle_name"] = frame[MIDDLE].str.strip()
    out["last_name"] = frame[LAST].str.strip()
    out["suffix"] = frame[SUFFIX].str.strip()
    out["credential"] = frame[CREDENTIAL].str.strip()
    out["display_name"] = frame.apply(
        lambda row: build_display_name(
            row[FIRST], row[MIDDLE], row[LAST], row[SUFFIX], row[CREDENTIAL]
        ),
        axis=1,
    )
    out["primary_taxonomy_code"] = primary
    out["primary_specialty"] = primary.map(taxonomy_labels).fillna("Physician")
    out["address_line_1"] = frame[ADDRESS_1].str.strip()
    out["address_line_2"] = frame[ADDRESS_2].str.strip()
    out["city"] = frame[CITY].str.strip()
    out["state"] = frame[STATE].str.strip()
    out["postal_code"] = frame[ZIP_CODE].str.strip().str.slice(0, 10)
    out["country_code"] = frame[COUNTRY].str.strip()
    out["phone"] = frame[PHONE].str.strip()
    out["enumeration_date"] = frame[ENUMERATION_DATE].str.strip()
    out["last_updated"] = frame[LAST_UPDATED].str.strip()
    out["active"] = 1
    out["source"] = "NPPES"
    out["profile_status"] = "unclaimed"
    return out.drop_duplicates(subset=["npi"])


def build_database(
    source: Path,
    taxonomy_csv: Path,
    output: Path,
    schema_path: Path,
    chunksize: int,
    limit: int | None,
    states: set[str] | None,
) -> int:
    ensure_parent(output)
    physician_codes, taxonomy_labels = load_physician_taxonomies(taxonomy_csv)
    columns = read_header(source)
    tax_cols = taxonomy_code_columns(columns)
    switch_cols = taxonomy_switch_columns(columns)

    required = [
        ENTITY_TYPE,
        NPI,
        FIRST,
        MIDDLE,
        LAST,
        SUFFIX,
        CREDENTIAL,
        ADDRESS_1,
        ADDRESS_2,
        CITY,
        STATE,
        ZIP_CODE,
        COUNTRY,
        PHONE,
        ENUMERATION_DATE,
        LAST_UPDATED,
        DEACTIVATION_DATE,
        REACTIVATION_DATE,
        *tax_cols,
        *switch_cols,
    ]
    missing = [column for column in required if column not in columns]
    if missing:
        raise ValueError(f"NPPES file is missing expected columns: {missing}")

    if output.exists():
        output.unlink()
    connection = sqlite3.connect(output)
    initialize_database(connection, schema_path)

    total = 0
    for index, chunk in enumerate(chunk_reader(source, required, chunksize), start=1):
        transformed = transform_chunk(
            chunk,
            physician_codes,
            taxonomy_labels,
            tax_cols,
            switch_cols,
            states,
        )
        if transformed.empty:
            print(f"chunk {index}: 0 physicians")
            continue
        if limit is not None and total + len(transformed) > limit:
            transformed = transformed.iloc[: limit - total]
        transformed.to_sql(
            "physicians",
            connection,
            if_exists="append",
            index=False,
            method="multi",
            chunksize=500,
        )
        total += len(transformed)
        print(f"chunk {index}: +{len(transformed):,} ({total:,} total)")
        if limit is not None and total >= limit:
            break

    connection.executescript(
        """
        CREATE INDEX IF NOT EXISTS idx_physicians_last_first
          ON physicians(last_name, first_name);
        CREATE INDEX IF NOT EXISTS idx_physicians_state_city
          ON physicians(state, city);
        CREATE INDEX IF NOT EXISTS idx_physicians_specialty
          ON physicians(primary_specialty);

        INSERT INTO agents (id, physician_npi, status, claimed, public_posting_enabled)
        SELECT 'agent-' || npi, npi, 'reserved', 0, 0 FROM physicians;

        INSERT INTO physician_fts(npi, display_name, primary_specialty, city, state)
        SELECT npi, display_name, primary_specialty, city, state FROM physicians;
        """
    )
    connection.commit()

    summary = {
        "physicians": connection.execute("SELECT COUNT(*) FROM physicians").fetchone()[0],
        "reserved_agents": connection.execute("SELECT COUNT(*) FROM agents").fetchone()[0],
        "states": connection.execute(
            "SELECT COUNT(DISTINCT state) FROM physicians WHERE state <> ''"
        ).fetchone()[0],
    }
    print(json.dumps(summary, indent=2))
    connection.close()
    return total


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Build a searchable SQLite physician directory from NPPES."
    )
    parser.add_argument("--source", type=Path, required=True, help="NPPES ZIP or main CSV")
    parser.add_argument("--taxonomy", type=Path, required=True, help="NUCC taxonomy CSV")
    parser.add_argument(
        "--output",
        type=Path,
        default=Path("data/processed/lamina.sqlite"),
    )
    parser.add_argument(
        "--schema",
        type=Path,
        default=Path("sql/schema.sql"),
    )
    parser.add_argument("--chunksize", type=int, default=100_000)
    parser.add_argument("--limit", type=int, help="Stop after N physician records")
    parser.add_argument(
        "--states",
        help="Optional comma-separated state codes, e.g. CA,WA,NY",
    )
    args = parser.parse_args()

    states = {value.strip().upper() for value in args.states.split(",")} if args.states else None
    build_database(
        source=args.source,
        taxonomy_csv=args.taxonomy,
        output=args.output,
        schema_path=args.schema,
        chunksize=args.chunksize,
        limit=args.limit,
        states=states,
    )


if __name__ == "__main__":
    main()
