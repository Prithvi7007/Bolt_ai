"""Provider-configurable approved model gateway for structured query plans only."""
from __future__ import annotations
from dataclasses import dataclass
import json
import re
from urllib.parse import urlparse
from urllib.request import Request, urlopen

from .planner import QueryPlan


_ALLOWED_CONTEXT = ("metric", "dimension", "period", "result_ref")


def bounded_context(memory: dict) -> dict:
    context = {key: memory[key] for key in _ALLOWED_CONTEXT if key in memory}
    encoded = json.dumps(context, separators=(",", ":"))
    if len(encoded) > 2000:
        raise ValueError("Working context exceeded the bounded model contract")
    return context


@dataclass(frozen=True)
class GatewayConfig:
    endpoint: str
    model: str
    token: str = ""
    timeout_seconds: int = 30
    max_response_bytes: int = 64_000


class OpenAICompatibleGateway:
    def __init__(self, config: GatewayConfig, *, transport=None):
        parsed = urlparse(config.endpoint)
        loopback = parsed.hostname in {"127.0.0.1", "localhost", "::1"}
        if parsed.scheme != "https" and not (parsed.scheme == "http" and loopback):
            raise ValueError("Approved model endpoint must use HTTPS")
        if not config.model.strip():
            raise ValueError("Approved model name is required")
        if config.timeout_seconds < 1 or config.timeout_seconds > 120:
            raise ValueError("Model timeout is outside policy")
        self.config = config
        self._transport = transport
        self.last_usage = {"prompt_tokens": 0, "completion_tokens": 0, "cached_tokens": 0}

    def plan(self, question: str, context: dict, catalog: list[dict]) -> dict:
        clean_context = bounded_context(context)
        payload = {
            "model": self.config.model,
            "temperature": 0,
            "response_format": {"type": "json_object"},
            "messages": [
                {
                    "role": "system",
                    "content": (
                        "Return only a JSON query plan with metric, dimension, period, start, end. "
                        "Use only the supplied semantic catalog. Never emit SQL."
                    ),
                },
                {
                    "role": "user",
                    "content": json.dumps({
                        "question": question[:2000],
                        "working_context": clean_context,
                        "semantic_catalog": catalog,
                    }, separators=(",", ":")),
                },
            ],
        }
        headers = {"Content-Type": "application/json"}
        if self.config.token:
            headers["Authorization"] = "Bearer " + self.config.token
        body = json.dumps(payload).encode("utf-8")
        if self._transport is not None:
            raw = self._transport(self.config.endpoint, body, headers, self.config.timeout_seconds)
        else:
            request = Request(self.config.endpoint.rstrip("/") + "/chat/completions", data=body, headers=headers)
            with urlopen(request, timeout=self.config.timeout_seconds) as response:
                raw = response.read(self.config.max_response_bytes + 1)
        if len(raw) > self.config.max_response_bytes:
            raise RuntimeError("Model response exceeded the configured limit")
        response = json.loads(raw)
        usage = response.get("usage") or {}
        details = usage.get("prompt_tokens_details") or {}
        self.last_usage = {
            "prompt_tokens": int(usage.get("prompt_tokens", 0)),
            "completion_tokens": int(usage.get("completion_tokens", 0)),
            "cached_tokens": int(usage.get("cached_tokens", details.get("cached_tokens", 0))),
        }
        content = response["choices"][0]["message"]["content"]
        plan = json.loads(content)
        required = {"metric", "dimension", "period", "start", "end"}
        if set(plan) != required or not all(isinstance(plan[key], str) for key in required):
            raise ValueError("Model returned an invalid structured query plan")
        return plan


def query_plan_from_gateway(payload: dict) -> QueryPlan:
    required = ("metric", "dimension", "period", "start", "end")
    if set(payload) != set(required):
        raise ValueError("Gateway plan fields are invalid")
    plan = QueryPlan(*(str(payload[key]) for key in required))
    if plan.metric != "revenue" or plan.dimension not in {"month", "region", "channel"}:
        raise ValueError("Gateway selected an unapproved metric or dimension")
    month_pattern = re.compile(r"^(\d{4})-(0[1-9]|1[0-2])$")
    start_match = month_pattern.fullmatch(plan.start)
    end_match = month_pattern.fullmatch(plan.end)
    if not start_match or not end_match:
        raise ValueError("Gateway selected an invalid date range")
    start_month = int(start_match.group(1)) * 12 + int(start_match.group(2))
    end_month = int(end_match.group(1)) * 12 + int(end_match.group(2))
    if start_month > end_month or end_month - start_month > 23:
        raise ValueError("Gateway selected an invalid date range")
    return plan
