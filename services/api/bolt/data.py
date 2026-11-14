"""Synthetic SQLite adapter. Real Snowflake adapter intentionally absent."""
from dataclasses import dataclass
from pathlib import Path
import sqlite3
import csv
from .planner import QueryPlan


@dataclass
class QueryResult:
    columns: list[str]
    rows: list[dict]
    sql: str
    params: dict


_ALLOWED_DIMS = frozenset(('month','region','channel'))


def load_fixture(path: Path) -> sqlite3.Connection:
    if not path.is_file():
        raise FileNotFoundError(f'Synthetic fixture missing: {path}')
    con = sqlite3.connect(':memory:')
    con.row_factory = sqlite3.Row
    con.execute('CREATE TABLE revenue (month TEXT NOT NULL, region TEXT NOT NULL, channel TEXT NOT NULL, revenue REAL NOT NULL CHECK(revenue >= 0))')
    with path.open(newline='',encoding='utf-8') as f:
        rows=[]
        for r in csv.DictReader(f):
            rows.append((r['month'],r['region'],r['channel'],float(r['revenue'])))
    con.executemany('INSERT INTO revenue (month,region,channel,revenue) VALUES (?,?,?,?)', rows)
    con.commit()
    con.execute('PRAGMA query_only = ON')
    return con


def run_query(plan: QueryPlan, connection: sqlite3.Connection) -> QueryResult:
    if plan.metric != 'revenue' or plan.dimension not in _ALLOWED_DIMS:
        raise ValueError('Metric or dimension is not approved')
    # Dimension selection is enum-validated, filter values parameterized, dataset read-only.
    sql=(f'SELECT {plan.dimension}, ROUND(SUM(revenue), 2) AS revenue '
         'FROM revenue WHERE month >= :start AND month <= :end '
         f'GROUP BY {plan.dimension} ORDER BY {plan.dimension} LIMIT 100')
    params={'start':plan.start,'end':plan.end}
    rows=[dict(r) for r in connection.execute(sql,params).fetchall()]
    if len(rows)>100:
        raise RuntimeError('Prototype query exceeded row limit')
    return QueryResult([plan.dimension,'revenue'],rows,sql,params)
