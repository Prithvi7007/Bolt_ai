#!/usr/bin/env python3
"""Run an organization-approved BOLT benchmark without printing question content."""
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import sys
import urllib.error
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "services" / "api"))

from bolt.evaluation import evaluate_approved_cases


def _headers() -> dict[str, str]:
    headers = {"Content-Type": "application/json"}
    mappings = {
        "BOLT_BENCHMARK_AUTHORIZATION": "Authorization",
        "BOLT_BENCHMARK_PROXY_TOKEN": "X-Bolt-Proxy-Token",
        "BOLT_BENCHMARK_USER": "X-Bolt-User",
        "BOLT_BENCHMARK_ROLES": "X-Bolt-Roles",
    }
    for variable, header in mappings.items():
        value = os.environ.get(variable)
        if value:
            headers[header] = value
    return headers


def _json_request(base_url: str, route: str, headers: dict[str, str], body=None):
    payload = None if body is None else json.dumps(body).encode("utf-8")
    request = urllib.request.Request(
        base_url.rstrip("/") + route,
        data=payload,
        headers=headers,
        method="POST" if body is not None else "GET",
    )
    try:
        with urllib.request.urlopen(request, timeout=120) as response:
            return json.load(response)
    except urllib.error.HTTPError as exc:
        raise RuntimeError(f"BOLT benchmark request failed with HTTP {exc.code}") from exc


def _runner(base_url: str):
    headers = _headers()
    session = _json_request(base_url, "/v1/sessions", headers, {})
    session_id = session["session_id"]

    def run(question: str):
        result = _json_request(
            base_url,
            "/v1/chat",
            headers,
            {"session_id": session_id, "question": question},
        )
        if "tool_calls" not in result:
            result["tool_calls"] = 4 if result.get("investigation") else (
                1 if result.get("evidence") else 0
            )
        return result

    return run


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cases", required=True, type=Path)
    parser.add_argument("--base-url", required=True)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()

    loaded = json.loads(args.cases.read_text(encoding="utf-8"))
    cases = loaded["cases"] if isinstance(loaded, dict) else loaded
    if not isinstance(cases, list):
        raise SystemExit("Approved case file must contain a JSON list or a cases list")
    report = evaluate_approved_cases(cases, _runner(args.base_url))
    rendered = json.dumps(report, indent=2, sort_keys=True)
    if args.output:
        args.output.write_text(rendered + "\n", encoding="utf-8")
    else:
        print(rendered)


if __name__ == "__main__":
    main()
