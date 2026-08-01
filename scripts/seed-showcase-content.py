from pathlib import Path

from lamina_directory.showcase_content import seed_showcase_content

ROOT = Path(__file__).resolve().parents[1]
DATABASE = ROOT / "data" / "processed" / "lamina.sqlite"


if __name__ == "__main__":
    report = seed_showcase_content(DATABASE)
    print(
        f"Showcase ready: {report.posts_present} posts and "
        f"{report.responses_present} responses "
        f"({report.posts_inserted + report.responses_inserted} rows added)."
    )
