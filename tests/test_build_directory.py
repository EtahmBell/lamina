from __future__ import annotations

import sqlite3
import zipfile
from pathlib import Path

import pandas as pd

from lamina_directory.build_directory import build_database


def test_build_database(tmp_path: Path) -> None:
    taxonomy = pd.DataFrame(
        [
            {
                "Code": "207R00000X",
                "Grouping": "Allopathic & Osteopathic Physicians",
                "Classification": "Internal Medicine",
                "Specialization": "",
                "Display Name": "Internal Medicine Physician",
            },
            {
                "Code": "163W00000X",
                "Grouping": "Nursing Service Providers",
                "Classification": "Registered Nurse",
                "Specialization": "",
                "Display Name": "Registered Nurse",
            },
        ]
    )
    taxonomy_path = tmp_path / "taxonomy.csv"
    taxonomy.to_csv(taxonomy_path, index=False)

    columns = {
        "NPI": ["1234567890", "9999999999"],
        "Entity Type Code": ["1", "1"],
        "Provider First Name": ["Amy", "Robin"],
        "Provider Middle Name": ["J", ""],
        "Provider Last Name (Legal Name)": ["Chen", "Nurse"],
        "Provider Name Suffix Text": ["", ""],
        "Provider Credential Text": ["MD", "RN"],
        "Provider First Line Business Practice Location Address": ["1 Main St", "2 Main St"],
        "Provider Second Line Business Practice Location Address": ["", ""],
        "Provider Business Practice Location Address City Name": ["Seattle", "Seattle"],
        "Provider Business Practice Location Address State Name": ["WA", "WA"],
        "Provider Business Practice Location Address Postal Code": ["98101", "98101"],
        "Provider Business Practice Location Address Country Code (If outside U.S.)": ["US", "US"],
        "Provider Business Practice Location Address Telephone Number": ["5555551111", "5555552222"],
        "Provider Enumeration Date": ["01/01/2020", "01/01/2020"],
        "Last Update Date": ["01/01/2026", "01/01/2026"],
        "NPI Deactivation Date": ["", ""],
        "NPI Reactivation Date": ["", ""],
        "Healthcare Provider Taxonomy Code_1": ["207R00000X", "163W00000X"],
        "Healthcare Provider Primary Taxonomy Switch_1": ["Y", "Y"],
    }
    nppes = pd.DataFrame(columns)
    csv_path = tmp_path / "npidata_pfile_test.csv"
    nppes.to_csv(csv_path, index=False)
    zip_path = tmp_path / "nppes.zip"
    with zipfile.ZipFile(zip_path, "w") as archive:
        archive.write(csv_path, csv_path.name)

    output = tmp_path / "lamina.sqlite"
    schema = Path(__file__).parents[1] / "sql" / "schema.sql"
    count = build_database(zip_path, taxonomy_path, output, schema, 100, None, None)
    assert count == 1

    with sqlite3.connect(output) as connection:
        physician = connection.execute(
            "SELECT display_name, primary_specialty FROM physicians"
        ).fetchone()
        agent = connection.execute("SELECT status, claimed FROM agents").fetchone()
    assert physician == ("Amy J Chen, MD", "Internal Medicine Physician")
    assert agent == ("reserved", 0)
