from dataclasses import replace
import pytest

from bolt.governance import QueryPolicy, QueryRejected
from bolt.planner import QueryPlan
from bolt.snowflake_adapter import SnowflakeConfig, SnowflakeQueryAdapter


APPROVED = "ANALYTICS.SEMANTIC.REVENUE"


def policy():
    return QueryPolicy(
        allowed_objects=frozenset({APPROVED}),
        allowed_columns=frozenset({"MONTH", "REGION", "CHANNEL", "REVENUE"}),
        max_rows=100,
    )


def test_query_policy_accepts_one_bounded_approved_select():
    sql = (
        "SELECT channel, SUM(revenue) AS revenue "
        f"FROM {APPROVED} WHERE month >= :start AND month <= :end "
        "GROUP BY channel ORDER BY channel LIMIT 100"
    )
    normalized = policy().validate(sql)
    assert normalized.startswith("SELECT ")
    assert normalized.endswith("LIMIT 100")


@pytest.mark.parametrize("sql", [
    f"DELETE FROM {APPROVED}",
    f"SELECT * FROM {APPROVED} LIMIT 100",
    f"SELECT channel FROM {APPROVED}; SELECT region FROM {APPROVED}",
    "SELECT channel FROM OTHER_DB.PUBLIC.REVENUE LIMIT 100",
    f"SELECT customer_email FROM {APPROVED} LIMIT 100",
    f"SELECT channel FROM {APPROVED} LIMIT 101",
    f"SELECT channel FROM {APPROVED} UNION SELECT region FROM {APPROVED} LIMIT 100",
    f"WITH x AS (SELECT channel FROM {APPROVED}) SELECT channel FROM x LIMIT 100",
])
def test_query_policy_rejects_writes_unapproved_objects_columns_and_limits(sql):
    with pytest.raises(QueryRejected):
        policy().validate(sql)


class FakeCursor:
    def __init__(self):
        self.calls = []
        self.description = [("CHANNEL",), ("REVENUE",)]
        self.sfqid = "01b-test-query"
    def execute(self, sql, params=None, timeout=None):
        self.calls.append((sql, params, timeout))
        return self
    def fetchmany(self, count):
        assert count == 101
        return [("Search", 125.5), ("Social", 100.0)]


class FakeConnection:
    def __init__(self):
        self.cursor_value = FakeCursor()
        self.closed = False
    def cursor(self):
        return self.cursor_value
    def close(self):
        self.closed = True


def test_snowflake_adapter_is_disabled_by_default_and_returns_audited_evidence():
    with pytest.raises(ValueError, match="disabled"):
        SnowflakeQueryAdapter(SnowflakeConfig()).execute(
            QueryPlan("revenue", "channel", "2026", "2026-01", "2026-12"),
            actor_id="analyst-1",
        )

    connection = FakeConnection()
    config = SnowflakeConfig(
        enabled=True,
        account="test_account",
        user="svc_bolt",
        password="not-logged",
        role="BOLT_READER",
        warehouse="BOLT_WH",
        database="ANALYTICS",
        schema="SEMANTIC",
        source_object=APPROVED,
        timeout_seconds=30,
        max_rows=100,
    )
    adapter = SnowflakeQueryAdapter(config, connect=lambda **kwargs: connection)
    result = adapter.execute(
        QueryPlan("revenue", "channel", "2026", "2026-01", "2026-12"),
        actor_id="analyst-1",
    )

    assert result.rows == [
        {"channel": "Search", "revenue": 125.5},
        {"channel": "Social", "revenue": 100.0},
    ]
    assert result.query_id == "01b-test-query"
    assert result.source == APPROVED
    assert result.role == "BOLT_READER"
    assert result.is_synthetic is False
    assert connection.closed is True
    executed = connection.cursor_value.calls
    assert len(executed) == 1
    assert executed[0][2] == 30
    assert "LIMIT 100" in executed[0][0]
    assert "analyst-1" not in executed[0][0]
