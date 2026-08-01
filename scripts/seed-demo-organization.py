from pathlib import Path

from lamina_directory.demo_organization import seed_demo_organization

ROOT = Path(__file__).resolve().parents[1]
DATABASE = ROOT / "data" / "processed" / "lamina.sqlite"


if __name__ == "__main__":
    result = seed_demo_organization(DATABASE)
    state = "configured" if result["configured"] else "unconfigured"
    print("Seeded Lamina Demo Medical Group with Ethan Bell and Lianne Cha.")
    print(f"Medplum connection: {state} through DEFAULT_MEDPLUM.")
