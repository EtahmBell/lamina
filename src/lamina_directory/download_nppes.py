from __future__ import annotations

import argparse
import re
from pathlib import Path
from urllib.parse import urljoin

import requests
from bs4 import BeautifulSoup
from tqdm import tqdm

from .common import ensure_parent

NPPES_FILES_PAGE = "https://download.cms.gov/nppes/NPI_Files.html"
DEFAULT_TIMEOUT = 60


def discover_latest_monthly_url(session: requests.Session) -> str:
    response = session.get(NPPES_FILES_PAGE, timeout=DEFAULT_TIMEOUT)
    response.raise_for_status()
    soup = BeautifulSoup(response.text, "html.parser")

    candidates: list[str] = []
    for link in soup.find_all("a", href=True):
        href = str(link["href"])
        label = " ".join(link.get_text(" ", strip=True).split())
        combined = f"{label} {href}".lower()
        if "data_dissemination" not in combined and "data dissemination" not in combined:
            continue
        if not href.lower().endswith(".zip"):
            continue
        if "deactivation" in combined or "weekly" in combined or "update" in combined:
            continue
        if "v2" not in combined and "v.2" not in combined:
            continue
        candidates.append(urljoin(NPPES_FILES_PAGE, href))

    if not candidates:
        raise RuntimeError("Could not find the latest monthly NPPES V2 ZIP on the CMS page.")

    def sortable(url: str) -> tuple[int, int]:
        match = re.search(r"(20\d{2})", url)
        year = int(match.group(1)) if match else 0
        month_names = {
            name.lower(): index
            for index, name in enumerate(
                [
                    "January",
                    "February",
                    "March",
                    "April",
                    "May",
                    "June",
                    "July",
                    "August",
                    "September",
                    "October",
                    "November",
                    "December",
                ],
                start=1,
            )
        }
        month = max((number for name, number in month_names.items() if name in url.lower()), default=0)
        return year, month

    return max(set(candidates), key=sortable)


def download(url: str, output: Path, force: bool = False) -> Path:
    ensure_parent(output)
    if output.exists() and not force:
        print(f"Already exists: {output}")
        return output

    with requests.Session() as session, session.get(
        url, stream=True, timeout=DEFAULT_TIMEOUT
    ) as response:
        response.raise_for_status()
        total = int(response.headers.get("content-length", 0))
        temporary = output.with_suffix(output.suffix + ".part")
        with temporary.open("wb") as handle, tqdm(
            total=total,
            unit="B",
            unit_scale=True,
            desc=output.name,
        ) as progress:
            for chunk in response.iter_content(chunk_size=8 * 1024 * 1024):
                if not chunk:
                    continue
                handle.write(chunk)
                progress.update(len(chunk))
        temporary.replace(output)
    return output


def main() -> None:
    parser = argparse.ArgumentParser(description="Download the latest monthly NPPES V2 bulk file.")
    parser.add_argument("--url", help="Override the CMS download URL.")
    parser.add_argument(
        "--output",
        type=Path,
        default=Path("data/raw/nppes-latest-v2.zip"),
    )
    parser.add_argument("--force", action="store_true")
    args = parser.parse_args()

    with requests.Session() as session:
        url = args.url or discover_latest_monthly_url(session)
    print(f"Downloading: {url}")
    print(download(url, args.output, args.force))


if __name__ == "__main__":
    main()
