from pathlib import Path

from bolt.evaluation import evaluate_synthetic


FIXTURE = Path(__file__).resolve().parents[3] / "fixtures" / "synthetic" / "revenue.csv"


def test_v1_evaluation_reports_denominators_accuracy_safety_provenance_and_context():
    report = evaluate_synthetic(FIXTURE)
    assert report["question_set"]["denominator"] >= 20
    assert report["question_set"]["accuracy"] >= 0.95
    assert report["question_set"]["wilson_95_low"] > 0
    assert report["provenance"]["rate"] == 1.0
    assert report["safety"]["accepted_write_queries"] == 0
    assert report["safety"]["denominator"] >= 6
    assert report["context"]["reduction"] >= 0.40
    assert report["context"]["accuracy_delta"] == 0.0
    assert report["orchestration"]["max_tool_calls"] <= 10
