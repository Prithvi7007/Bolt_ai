"""Disabled-by-default Snowflake adapter with explicit governance and provenance."""
from __future__ import annotations
from dataclasses import dataclass
from hashlib import sha256
from typing import Callable

from .data import QueryResult
from .governance import QueryPolicy
from .planner import QueryPlan
from .semantic_catalog import definition


@dataclass(frozen=True)
class SnowflakeConfig:
    enabled: bool = False
    account: str = ""
    user: str = ""
    password: str = ""
    role: str = ""
    warehouse: str = ""
    database: str = ""
    schema: str = ""
    source_object: str = "ANALYTICS.SEMANTIC.REVENUE"
    timeout_seconds: int = 30
    max_rows: int = 100

    def require_ready(self) -> None:
        if not self.enabled:
            raise ValueError("Snowflake adapter is disabled")
        required = (self.account, self.user, self.role, self.warehouse, self.database, self.schema)
        if not all(value.strip() for value in required):
            raise ValueError("Snowflake configuration is incomplete")
        if not self.password:
            raise ValueError("Snowflake server-side credential is missing")
        if self.timeout_seconds < 1 or self.timeout_seconds > 120:
            raise ValueError("Snowflake timeout is outside policy")
        if self.max_rows < 1 or self.max_rows > 1000:
            raise ValueError("Snowflake row limit is outside policy")


class SnowflakeQueryAdapter:
    def __init__(self, config: SnowflakeConfig, *, connect: Callable | None = None):
        self.config = config
        self._connect = connect

    def _connector(self):
        if self._connect is not None:
            return self._connect
        try:
            from snowflake.connector import connect
        except ImportError as exc:
            raise RuntimeError(
                "Install requirements-enterprise.txt in the approved server runtime"
            ) from exc
        return connect

    def execute(self, plan: QueryPlan, actor_id: str = "local") -> QueryResult:
        self.config.require_ready()
        metric = definition(plan.metric)
        if plan.dimension not in metric.dimensions:
            raise ValueError("Dimension is not compatible with the approved metric")
        dimension = plan.dimension
        policy = QueryPolicy(
            allowed_objects=frozenset({self.config.source_object}),
            allowed_columns=frozenset({"MONTH", "REGION", "CHANNEL", "REVENUE"}),
            max_rows=self.config.max_rows,
        )
        sql = (
            f"SELECT {dimension}, ROUND(SUM(revenue), 2) AS revenue "
            f"FROM {self.config.source_object} "
            "WHERE month >= %(start)s AND month <= %(end)s "
            f"GROUP BY {dimension} ORDER BY {dimension} LIMIT {self.config.max_rows}"
        )
        sql = policy.validate(sql)
        tag_actor = sha256(actor_id.encode("utf-8")).hexdigest()[:16]
        connector = self._connector()
        connection = connector(
            account=self.config.account,
            user=self.config.user,
            password=self.config.password,
            role=self.config.role,
            warehouse=self.config.warehouse,
            database=self.config.database,
            schema=self.config.schema,
            session_parameters={"QUERY_TAG": f"BOLT_V1:{tag_actor}:{plan.metric}:{dimension}"},
        )
        cursor = None
        try:
            cursor = connection.cursor()
            cursor.execute(
                sql,
                {"start": plan.start, "end": plan.end},
                timeout=self.config.timeout_seconds,
            )
            raw_rows = cursor.fetchmany(self.config.max_rows + 1)
            if len(raw_rows) > self.config.max_rows:
                raise RuntimeError("Snowflake result exceeded the configured row limit")
            columns = [str(item[0]).lower() for item in cursor.description]
            rows = [dict(zip(columns, row)) for row in raw_rows]
            return QueryResult(
                columns=columns,
                rows=rows,
                sql=sql,
                params={"start": plan.start, "end": plan.end},
                query_id=str(getattr(cursor, "sfqid", "") or ""),
                source=self.config.source_object,
                role=self.config.role,
                metric_id=metric.metric_id,
                freshness=None,
                is_synthetic=False,
            )
        finally:
            close_cursor = getattr(cursor, "close", None)
            if callable(close_cursor):
                close_cursor()
            connection.close()
