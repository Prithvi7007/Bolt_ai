"""Run the local subset calculation and provider-isolation contract."""
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[3]


def test_local_category_filter_contract():
    result = subprocess.run(
        ["node", "--test", "apps/desktop/src/category-filter.test.mjs"],
        cwd=ROOT, text=True, capture_output=True, encoding="utf-8", timeout=30,
    )
    assert result.returncode == 0, result.stdout + result.stderr
