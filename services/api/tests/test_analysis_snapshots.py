"""Run the local saved-analysis file and IPC boundary contracts."""
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[3]


def test_local_analysis_snapshot_contract():
    result = subprocess.run(
        ["node", "--test", "apps/desktop/electron/analysis-snapshot.test.cjs"],
        cwd=ROOT, text=True, capture_output=True, encoding="utf-8", timeout=35,
    )
    assert result.returncode == 0, result.stdout + result.stderr
