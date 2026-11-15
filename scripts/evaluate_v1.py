"""Print the reproducible BOLT v1 synthetic evaluation report as JSON."""
from pathlib import Path
import json
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "services" / "api"))

from bolt.evaluation import evaluate_synthetic


if __name__ == "__main__":
    report = evaluate_synthetic(ROOT / "fixtures" / "synthetic" / "revenue.csv")
    print(json.dumps(report, indent=2, sort_keys=True))
