"""Contract regression tests for the native Electron window integration smoke test."""
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[3]


def test_gui_verifier_is_isolated_and_exercises_real_renderer():
    gui = (ROOT / "scripts/verify_electron_gui.mjs").read_text()
    assert "--remote-debugging-address=127.0.0.1" in gui
    assert "mkdtempSync" in gui and "APPDATA: sandbox" in gui
    assert "Runtime.evaluate" in gui
    assert 'window.boltApi?.request' in gui
    assert "2026 revenue by channel" in gui
    assert "result-chart" in gui and "pre.sql code" in gui
    assert "data-table-wrapper tbody tr" in gui
    assert "await launch(sandbox)" in gui
    assert "Restart must restore the same conversation" in gui
    assert "taskkill" in gui and "/T" in gui and "/F" in gui


def test_windows_ci_runs_gui_after_packaged_backend_is_verified():
    smoke = (ROOT / "scripts/verify_packaged_backend.py").read_text()
    assert 'sys.platform == "win32"' in smoke
    assert 'os.environ.get("GITHUB_ACTIONS") == "true"' in smoke
    assert "verify_electron_gui.mjs" in smoke
    assert smoke.index("verify(args.executable,") < smoke.index("gui_test =")


def test_node_checks_gui_smoke_script_syntax():
    path = ROOT / "scripts/verify_electron_gui.mjs"
    result = subprocess.run(
        ["node", "--check", str(path)], capture_output=True, text=True, timeout=15
    )
    assert result.returncode == 0, result.stderr
