from __future__ import annotations

import re
from collections.abc import Iterable
from pathlib import Path


def ensure_parent(path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)


def clean_text(value: object) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    if not text or text.lower() == "nan":
        return None
    return re.sub(r"\s+", " ", text)


def build_display_name(
    first_name: object,
    middle_name: object,
    last_name: object,
    suffix: object,
    credential: object,
) -> str:
    parts = [
        clean_text(first_name),
        clean_text(middle_name),
        clean_text(last_name),
        clean_text(suffix),
    ]
    name = " ".join(part for part in parts if part)
    cred = clean_text(credential)
    return f"{name}, {cred}" if cred else name


def fts_prefix_query(text: str) -> str:
    tokens = re.findall(r"[\w'-]+", text, flags=re.UNICODE)
    return " ".join(f'"{token.replace(chr(34), "")}"*' for token in tokens)


def first_present(values: Iterable[object]) -> str | None:
    for value in values:
        cleaned = clean_text(value)
        if cleaned:
            return cleaned
    return None
