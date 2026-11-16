"""Execute the dependency-free Electron connection tests in the offline runner."""
from pathlib import Path
import shutil
import subprocess
import pytest

ROOT = Path(__file__).resolve().parents[3]


def test_desktop_model_connection_and_private_ipc():
    node = shutil.which("node")
    if node is None:
        pytest.skip("Node is required for the desktop source tests")
    result = subprocess.run(
        [node, "--test",
         "apps/desktop/electron/model-settings.test.cjs",
         "apps/desktop/electron/runtime.test.cjs"],
        cwd=ROOT, text=True, capture_output=True, timeout=30,
    )
    assert result.returncode == 0, result.stdout + result.stderr
