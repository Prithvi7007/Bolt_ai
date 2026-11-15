from pathlib import Path
import pytest

from bolt.data import QueryResult, load_fixture
from bolt.engine import answer
from bolt.model_gateway import GatewayConfig, OpenAICompatibleGateway, query_plan_from_gateway


class FakeGateway:
    def __init__(self):
        self.context = None
        self.last_usage = {"prompt_tokens": 42, "completion_tokens": 9, "cached_tokens": 12}
    def plan(self, question, context, catalog):
        self.context = context
        return {
            "metric": "revenue",
            "dimension": "region",
            "period": "2026",
            "start": "2026-01",
            "end": "2026-12",
        }


class FakeAdapter:
    def execute(self, plan, actor_id):
        return QueryResult(
            columns=["region", "revenue"],
            rows=[{"region": "In-State", "revenue": 10.0}, {"region": "Out-of-State", "revenue": 20.0}],
            sql="SELECT region, SUM(revenue) AS revenue FROM governed.revenue LIMIT 100",
            params={"start": plan.start, "end": plan.end},
            query_id="sf_query_1",
            source="ANALYTICS.SEMANTIC.REVENUE",
            role="BOLT_READER",
            metric_id="finance.revenue",
            freshness="2026-11-15T00:00:00Z",
            is_synthetic=False,
        )


def test_optional_model_gateway_receives_only_bounded_working_context():
    gateway = FakeGateway()
    memory = {
        "metric": "revenue",
        "period": "2026",
        "result_ref": "query-1",
        "unapproved_literal": "secret customer record",
    }
    result = answer(
        "Compare the approved segments",
        memory,
        adapter=FakeAdapter(),
        gateway=gateway,
        actor_id="analyst-1",
    )
    assert result["status"] == "ok"
    assert result["evidence"]["query_id"] == "sf_query_1"
    assert result["evidence"]["role"] == "BOLT_READER"
    assert result["cost"]["llm_calls"] == 1
    assert result["cost"]["prompt_tokens"] == 42
    assert result["cost"]["completion_tokens"] == 9
    assert result["cost"]["cached_tokens"] == 12
    assert "unapproved_literal" not in gateway.context
    assert "secret customer record" not in str(gateway.context)


def test_gateway_configuration_rejects_unapproved_transport_and_missing_model():
    with pytest.raises(ValueError):
        OpenAICompatibleGateway(GatewayConfig(endpoint="http://models.example.com/v1", model="approved"))
    with pytest.raises(ValueError):
        OpenAICompatibleGateway(GatewayConfig(endpoint="https://models.example.com/v1", model=""))


def test_why_workflow_runs_bounded_association_investigation(tmp_path):
    fixture = Path(__file__).resolve().parents[3] / "fixtures" / "synthetic" / "revenue.csv"
    with load_fixture(fixture) as connection:
        result = answer(
            "Why did revenue change in 2026?",
            {"metric": "revenue", "period": "2026"},
            connection,
        )
    assert result["status"] == "ok"
    assert result["investigation"]["kind"] == "bounded_association"
    assert 1 <= result["investigation"]["queries_executed"] <= 10
    assert result["investigation"]["drivers"]
    assert any("causal" in item.lower() for item in result["limitations"])
    assert result["evidence"]["query_id"]


def test_gateway_plan_date_range_is_bounded():
    with pytest.raises(ValueError, match="date range"):
        query_plan_from_gateway({
            "metric": "revenue",
            "dimension": "channel",
            "period": "all-time",
            "start": "2000-01",
            "end": "2026-12",
        })
