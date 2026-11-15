from pathlib import Path


ROOT = Path(__file__).resolve().parents[3]


def test_approved_benchmark_cli_uses_external_case_file_and_secret_headers():
    script = ROOT / "scripts" / "evaluate_approved.py"
    assert script.is_file()
    source = script.read_text(encoding="utf-8")
    assert "--cases" in source
    assert "--base-url" in source
    assert "BOLT_BENCHMARK_AUTHORIZATION" in source
    assert "BOLT_BENCHMARK_PROXY_TOKEN" in source
    assert "evaluate_approved_cases" in source
    assert 'print(question)' not in source
