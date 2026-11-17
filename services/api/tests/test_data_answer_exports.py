"""Exercise the local export boundary in the offline runner."""
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[3]


def test_local_answer_export_contract():
    result = subprocess.run(
        ["node", "--test", "apps/desktop/electron/data-answer-export.test.cjs"],
        cwd=ROOT, text=True, capture_output=True, encoding="utf-8", timeout=30,
    )
    assert result.returncode == 0, result.stdout + result.stderr
