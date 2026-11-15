from pathlib import Path

from bolt.evaluation import evaluate_approved_cases, evaluate_synthetic


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


def test_approved_evaluation_reports_operational_metrics_without_question_content():
    cases = [
        {
            "case_id": "approved-01",
            "question": "Confidential revenue question one",
            "expected_status": "ok",
            "expected_dimension": "channel",
        },
        {
            "case_id": "approved-02",
            "question": "Confidential unsupported question two",
            "expected_status": "unsupported",
        },
    ]
    answers = iter([
        {
            "status": "ok",
            "data": {"columns": ["channel", "revenue"], "rows": []},
            "evidence": {
                "query_id": "q1",
                "source": "approved.source",
                "warehouse_credits": 0.01,
                "bytes_scanned": 1024,
            },
            "cost": {
                "prompt_tokens": 100,
                "completion_tokens": 20,
                "cached_tokens": 50,
            },
            "tool_calls": 2,
        },
        {
            "status": "unsupported",
            "data": None,
            "evidence": None,
            "cost": {
                "prompt_tokens": 30,
                "completion_tokens": 10,
                "cached_tokens": 0,
            },
            "tool_calls": 0,
        },
    ])
    ticks = iter([0.0, 0.05, 1.0, 1.2])
    report = evaluate_approved_cases(
        cases,
        lambda question: next(answers),
        clock=lambda: next(ticks),
    )

    assert report["question_set"]["correct"] == 2
    assert report["question_set"]["denominator"] == 2
    assert report["provenance"]["grounded"] == 1
    assert report["latency_ms"]["p50"] > 0
    assert report["tokens"]["prompt"] == 130
    assert report["tokens"]["completion"] == 30
    assert report["tokens"]["cached"] == 50
    assert report["queries"]["count"] == 1
    assert report["queries"]["warehouse_credits"] == 0.01
    assert report["queries"]["bytes_scanned"] == 1024
    assert report["orchestration"]["max_tool_calls"] == 2
    serialized = str(report)
    assert "Confidential revenue" not in serialized
    assert "Confidential unsupported" not in serialized
