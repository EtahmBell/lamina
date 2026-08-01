from __future__ import annotations

import argparse
from pathlib import Path

import requests

from .common import ensure_parent

DEFAULT_URL = "https://www.nucc.org/images/stories/CSV/nucc_taxonomy_261.csv"


def main() -> None:
    parser = argparse.ArgumentParser(description="Download the current NUCC taxonomy CSV.")
    parser.add_argument("--url", default=DEFAULT_URL)
    parser.add_argument(
        "--output",
        type=Path,
        default=Path("data/raw/nucc-taxonomy.csv"),
    )
    parser.add_argument("--force", action="store_true")
    args = parser.parse_args()

    ensure_parent(args.output)
    if args.output.exists() and not args.force:
        print(f"Already exists: {args.output}")
        return

    response = requests.get(args.url, timeout=60)
    response.raise_for_status()
    args.output.write_bytes(response.content)
    print(args.output)


if __name__ == "__main__":
    main()
