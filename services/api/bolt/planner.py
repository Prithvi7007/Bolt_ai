"""Bounded prototype query planning: no user-authored SQL is ever executed."""
from dataclasses import dataclass
import re


@dataclass(frozen=True)
class QueryPlan:
    metric: str
    dimension: str
    period: str
    start: str
    end: str


_DENY = re.compile(r'\b(drop|delete|truncate|alter|update|insert|create|grant|revoke|union|execute|exec|attach|pragma)\b', re.I)


def resolve(question: str, memory: dict) -> QueryPlan | None:
    q = question.strip().lower()
    if not q or _DENY.search(q) or re.search(r'\b(email address|customer name|pii|password|secret)\b', q):
        return None
    metric = 'revenue' if 'revenue' in q else memory.get('metric')
    if metric != 'revenue':
        return None
    if any(w in q for w in ('in-state', 'out-of-state', 'by region', 'regions', 'regional', 'compare region')):
        dimension = 'region'
    elif any(w in q for w in ('channel', 'channels', 'source', 'sources')):
        dimension = 'channel'
    elif any(w in q for w in ('trend', 'monthly', 'by month', 'over time', 'month')):
        dimension = 'month'
    elif re.search(r'\b(total|overall|how much|what was)\b', q):
        dimension = 'month'
    else:
        return None
    if '2025' in q:
        period, start, end = '2025','2025-01','2025-12'
    elif '2026' in q:
        period, start, end = '2026','2026-01','2026-12'
    elif memory.get('period') == '2025':
        period, start, end = '2025','2025-01','2025-12'
    elif memory.get('period') == '2026':
        period, start, end = '2026','2026-01','2026-12'
    else:
        # Prototype fixture latest available month: 2026-10.
        period, start, end = 'last12','2025-11','2026-10'
    return QueryPlan(metric,dimension,period,start,end)
