from pathlib import Path

from lamina_directory.seed_demo_physician import seed_demo_physician

ROOT = Path(__file__).resolve().parents[1]
DATABASE = ROOT / "data" / "processed" / "lamina.sqlite"


if __name__ == "__main__":
    seed_demo_physician(DATABASE)
    print("Seeded synthetic demo physicians Ethan Bell and Lianne Cha.")
