"""Approved metric and dimension definitions shared by planners and adapters."""
from __future__ import annotations
from dataclasses import asdict, dataclass


@dataclass(frozen=True)
class MetricDefinition:
    metric_id: str
    name: str
    description: str
    unit: str
    dimensions: tuple[str, ...]


REVENUE = MetricDefinition(
    metric_id="finance.revenue",
    name="revenue",
    description="Recognized revenue in USD for the selected reporting period.",
    unit="USD",
    dimensions=("month", "region", "channel"),
)
CATALOG = {"revenue": REVENUE}


def definition(metric: str) -> MetricDefinition:
    try:
        return CATALOG[metric]
    except KeyError as exc:
        raise ValueError("Metric is not approved") from exc


def catalog_payload() -> list[dict]:
    return [asdict(item) for item in CATALOG.values()]
