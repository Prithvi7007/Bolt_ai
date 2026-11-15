"""Guard the local-only Data Lab's Node regression suite and privacy boundaries."""
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[3]


def test_local_csv_profiler_regressions():
    suite = ROOT / "apps" / "desktop" / "src" / "dataset-understanding.test.mjs"
    result = subprocess.run(
        ["node", "--test", str(suite)],
        capture_output=True, text=True, encoding="utf-8", timeout=30,
    )
    assert result.returncode == 0, result.stdout + "\n" + result.stderr


def test_csv_data_is_never_transmitted_to_the_synthetic_backend():
    profiler = (ROOT / "apps" / "desktop" / "src" / "dataset-understanding.mjs").read_text(encoding="utf-8")
    lab = (ROOT / "apps" / "desktop" / "src" / "DatasetLab.tsx").read_text(encoding="utf-8")
    assert "profileCsvFile(file)" in lab
    assert "File" in lab
    for network_call in ("fetch(", "XMLHttpRequest", "sendBeacon(", "boltApi.request("):
        assert network_call not in profiler
        assert network_call not in lab
    assert "target" in lab.lower() and "Approve target" in lab
    assert "No file contents are sent" in lab

def test_local_analysis_regressions_and_network_boundary():
    suite = ROOT / "apps" / "desktop" / "src" / "local-analysis.test.mjs"
    result = subprocess.run(
        ["node", "--test", str(suite)],
        capture_output=True, text=True, encoding="utf-8", timeout=35,
    )
    assert result.returncode == 0, result.stdout + "\n" + result.stderr
    analysis = (ROOT / "apps" / "desktop" / "src" / "local-analysis.mjs").read_text(encoding="utf-8")
    analysis_ui = (ROOT / "apps" / "desktop" / "src" / "LocalAnalysis.tsx").read_text(encoding="utf-8")
    for network_call in ("fetch(", "XMLHttpRequest", "sendBeacon(", "boltApi.request("):
        assert network_call not in analysis
        assert network_call not in analysis_ui
    assert "analyzeCsvFile(file" in analysis_ui
    assert "No remote request" in analysis_ui

def test_ask_your_data_local_query_contract():
    """Questions and CSV analysis must stay inside the sandboxed renderer."""
    suite = ROOT / "apps" / "desktop" / "src" / "ask-data.test.mjs"
    result = subprocess.run(
        ["node", "--test", str(suite)],
        capture_output=True, text=True, encoding="utf-8", timeout=35,
    )
    assert result.returncode == 0, result.stdout + "\n" + result.stderr
    engine = (ROOT / "apps" / "desktop" / "src" / "ask-data.mjs").read_text(encoding="utf-8")
    gui = (ROOT / "apps" / "desktop" / "src" / "AskYourData.tsx").read_text(encoding="utf-8")
    lab = (ROOT / "apps" / "desktop" / "src" / "DatasetLab.tsx").read_text(encoding="utf-8")
    for network_call in ("fetch(", "XMLHttpRequest", "sendBeacon(", "boltApi.request("):
        assert network_call not in engine
        assert network_call not in gui
    assert "answerDataQuestion(file" in gui
    assert "approvedTarget && sourceFile && <AskYourData" in lab
    assert "No filters, forecasts or causal claims" in gui
    assert "No model" in engine
