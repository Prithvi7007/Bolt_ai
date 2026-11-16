"""Evidence-backed answers with optional governed adapters and bounded model planning."""
from __future__ import annotations
from uuid import uuid4

from .data import QueryResult, run_query
from .model_gateway import bounded_context, query_plan_from_gateway
from .planner import QueryPlan, resolve
from .semantic_catalog import catalog_payload


UNSUPPORTED = (
    "I can answer approved revenue questions by month, channel, or region. "
    "This request is outside the configured semantic catalog, and no query was executed."
)


def _execute(plan: QueryPlan, connection, adapter, actor_id: str) -> QueryResult:
    if adapter is not None:
        return adapter.execute(plan, actor_id=actor_id)
    if connection is None:
        raise RuntimeError("No governed query adapter is configured")
    return run_query(plan, connection)


def _cost(memory: dict, llm_calls: int = 0, usage: dict | None = None) -> dict:
    usage = usage or {}
    return {
        "prompt_tokens": int(usage.get("prompt_tokens", 0)),
        "completion_tokens": int(usage.get("completion_tokens", 0)),
        "cached_tokens": int(usage.get("cached_tokens", 0)),
        "context_characters": len(str(bounded_context(memory))),
        "llm_calls": llm_calls,
    }


def _evidence(result: QueryResult, query_id: str, row_count: int) -> dict:
    evidence = {
        "source": result.source,
        "query_id": query_id,
        "sql": result.sql,
        "parameters": result.params,
        "metric_id": result.metric_id,
        "row_count": row_count,
        "is_synthetic": result.is_synthetic,
        "freshness": result.freshness,
    }
    if result.role:
        evidence["role"] = result.role
    return evidence


def _periods(question: str, memory: dict) -> tuple[str, str, str, str, str, str]:
    q = question.lower()
    if "2025" in q or memory.get("period") == "2025":
        return "2025", "2025-01", "2025-12", "2024", "2024-01", "2024-12"
    return "2026", "2026-01", "2026-12", "2025", "2025-01", "2025-12"


def _investigate(question: str, memory: dict, connection, adapter, actor_id: str) -> dict:
    current, current_start, current_end, previous, previous_start, previous_end = _periods(question, memory)
    drivers = []
    query_results: list[QueryResult] = []
    for dimension in ("channel", "region"):
        current_result = _execute(
            QueryPlan("revenue", dimension, current, current_start, current_end),
            connection,
            adapter,
            actor_id,
        )
        previous_result = _execute(
            QueryPlan("revenue", dimension, previous, previous_start, previous_end),
            connection,
            adapter,
            actor_id,
        )
        query_results.extend((current_result, previous_result))
        current_values = {str(row[dimension]): float(row["revenue"]) for row in current_result.rows}
        previous_values = {str(row[dimension]): float(row["revenue"]) for row in previous_result.rows}
        for label in sorted(set(current_values) | set(previous_values)):
            before = previous_values.get(label, 0.0)
            after = current_values.get(label, 0.0)
            drivers.append({
                "dimension": dimension,
                "label": label,
                "current": round(after, 2),
                "previous": round(before, 2),
                "change": round(after - before, 2),
            })
    drivers.sort(key=lambda row: abs(row["change"]), reverse=True)
    top = drivers[:5]
    labels = [f"{row['dimension']}: {row['label']}" for row in top]
    values = [row["change"] for row in top]
    primary = query_results[0]
    query_id = "investigation_" + uuid4().hex[:12]
    answer_text = (
        f"The bounded comparison of {current} versus {previous} found the largest observed "
        f"association in {top[0]['dimension']} {top[0]['label']} "
        f"({top[0]['change']:+,.2f} USD). These are descriptive associations from approved "
        "breakdowns, not causal explanations."
    )
    return {
        "status": "ok",
        "answer": answer_text,
        "evidence": _evidence(primary, query_id, sum(len(item.rows) for item in query_results)),
        "data": {
            "columns": ["dimension", "label", "current", "previous", "change"],
            "rows": top,
        },
        "chart": {
            "type": "bar",
            "title": f"Observed revenue change: {current} vs {previous}",
            "labels": labels,
            "values": values,
            "unit": "USD",
        },
        "investigation": {
            "kind": "bounded_association",
            "queries_executed": len(query_results),
            "drivers": top,
            "periods": [previous, current],
        },
        "cost": _cost(memory),
        "memory_update": {
            "metric": "revenue",
            "dimension": "channel",
            "period": current,
            "result_ref": query_id,
        },
        "limitations": [
            "Observed associations are not causal claims.",
            "Only approved channel and region breakdowns were evaluated.",
            "Synthetic results are demonstrations unless a governed Snowflake adapter is configured.",
        ],
    }


def answer(
    question: str,
    memory: dict,
    connection=None,
    *,
    adapter=None,
    gateway=None,
    actor_id: str = "local",
) -> dict:
    q = question.strip().lower()
    if "why" in q and ("change" in q or "revenue" in q):
        return _investigate(question, memory, connection, adapter, actor_id)

    plan = resolve(question, memory)
    llm_calls = 0
    usage = None
    if plan is None and gateway is not None:
        payload = gateway.plan(question, bounded_context(memory), catalog_payload())
        plan = query_plan_from_gateway(payload)
        llm_calls = 1
        usage = getattr(gateway, "last_usage", None)
    cost = _cost(memory, llm_calls, usage)
    if plan is None:
        return {
            "status": "unsupported",
            "answer": UNSUPPORTED,
            "evidence": None,
            "data": None,
            "chart": None,
            "cost": cost,
            "memory_update": None,
            "limitations": [
                "The request did not resolve to an approved metric and dimension; no query ran."
            ],
        }

    result = _execute(plan, connection, adapter, actor_id)
    query_id = result.query_id or ("demo_" + uuid4().hex[:12])
    if not result.rows:
        return {
            "status": "no_data",
            "answer": "No governed records match this period. No revenue total is available.",
            "evidence": _evidence(result, query_id, 0),
            "data": {"columns": result.columns, "rows": []},
            "chart": None,
            "cost": cost,
            "memory_update": {
                "metric": plan.metric,
                "dimension": plan.dimension,
                "period": plan.period,
                "result_ref": query_id,
            },
            "limitations": ["No matching rows were returned."],
        }

    total = round(sum(float(row["revenue"]) for row in result.rows), 2)
    label = {
        "month": "monthly trend",
        "channel": "channel breakdown",
        "region": "regional comparison",
    }[plan.dimension]
    source_label = "synthetic demo" if result.is_synthetic else "governed source"
    text = (
        f"The {source_label} {label} for "
        f"{plan.period.replace('last12', 'the latest 12 available months')} "
        f"totals USD {total:,.2f} across {len(result.rows)} groups. "
        "The answer is grounded in the executed read-only query shown in evidence."
    )
    chart = {
        "type": "line" if plan.dimension == "month" else "bar",
        "title": f"Revenue — {label}",
        "labels": [str(row[plan.dimension]) for row in result.rows],
        "values": [round(float(row["revenue"]), 2) for row in result.rows],
        "unit": "USD",
    }
    limitations = (
        ["Demonstration data only; no Snowflake was queried."]
        if result.is_synthetic
        else ["Observational governed data; this answer does not establish causality."]
    )
    return {
        "status": "ok",
        "answer": text,
        "evidence": _evidence(result, query_id, len(result.rows)),
        "data": {"columns": result.columns, "rows": result.rows},
        "chart": chart,
        "cost": cost,
        "memory_update": {
            "metric": plan.metric,
            "dimension": plan.dimension,
            "period": plan.period,
            "result_ref": query_id,
        },
        "limitations": limitations,
    }
