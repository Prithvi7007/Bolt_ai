"""Fail-closed validation for the deliberately small generated Snowflake query grammar."""
from __future__ import annotations
from dataclasses import dataclass
import re


class QueryRejected(ValueError):
    pass


_FORBIDDEN = re.compile(
    r"\b(INSERT|UPDATE|DELETE|MERGE|DROP|ALTER|TRUNCATE|CREATE|GRANT|REVOKE|CALL|COPY|PUT|GET|REMOVE|USE|EXECUTE|EXEC|UNION|INTERSECT|EXCEPT|JOIN|WITH)\b",
    re.I,
)
_FROM = re.compile(r"\bFROM\s+([A-Za-z0-9_.$\"]+)", re.I)
_LIMIT = re.compile(r"\bLIMIT\s+(\d+)\s*$", re.I)
_IDENT = re.compile(r"[A-Za-z_][A-Za-z0-9_]*")
_ALLOWED_WORDS = {
    "SELECT", "DISTINCT", "SUM", "ROUND", "COUNT", "AVG", "MIN", "MAX", "AS",
    "WHERE", "AND", "OR", "BETWEEN", "GROUP", "BY", "ORDER", "ASC", "DESC",
    "LIMIT", "FROM",
}


@dataclass(frozen=True)
class QueryPolicy:
    allowed_objects: frozenset[str]
    allowed_columns: frozenset[str]
    max_rows: int = 100

    def validate(self, sql: str) -> str:
        candidate = " ".join(sql.strip().split())
        if not candidate or len(candidate) > 10_000:
            raise QueryRejected("Query is empty or too large")
        if ";" in candidate or "--" in candidate or "/*" in candidate or "*/" in candidate:
            raise QueryRejected("Multiple statements and comments are not allowed")
        if not re.match(r"^SELECT\b", candidate, re.I) or _FORBIDDEN.search(candidate):
            raise QueryRejected("Only one read-only SELECT is allowed")
        if re.search(r"(^|[\s,(])\*([\s,)]+|$)", candidate):
            raise QueryRejected("Wildcard selection is not allowed")

        source_match = _FROM.search(candidate)
        if not source_match:
            raise QueryRejected("A governed source is required")
        source = source_match.group(1).replace('"', "").upper()
        approved_objects = {item.replace('"', "").upper() for item in self.allowed_objects}
        if source not in approved_objects:
            raise QueryRejected("Source object is not approved")

        limit_match = _LIMIT.search(candidate)
        if not limit_match:
            raise QueryRejected("A terminal row limit is required")
        if int(limit_match.group(1)) < 1 or int(limit_match.group(1)) > self.max_rows:
            raise QueryRejected("Row limit exceeds policy")

        select_clause = candidate[6:source_match.start()]
        aliases = {match.group(1).upper() for match in re.finditer(r"\bAS\s+([A-Za-z_][A-Za-z0-9_]*)", select_clause, re.I)}
        approved_columns = {item.upper() for item in self.allowed_columns}
        for token in _IDENT.findall(select_clause):
            upper = token.upper()
            if upper in _ALLOWED_WORDS or upper in approved_columns or upper in aliases:
                continue
            raise QueryRejected(f"Column or function is not approved: {token}")
        return candidate
