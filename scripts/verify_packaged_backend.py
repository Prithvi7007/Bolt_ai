#!/usr/bin/env python3
"""Smoke-test an actual PyInstaller BOLT service using only Python's stdlib.

This checks the binary from the packaged Electron resources directory, NOT the
unbundled source-mode FastAPI server. Never prints the ephemeral bearer token.
"""
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import queue
import re
import secrets
import subprocess
import sys
import tempfile
import threading
import time
import urllib.error
import urllib.request


class SmokeFailure(RuntimeError):
    pass


def _readline(pipe, output: queue.Queue[str]) -> None:
    try:
        output.put(pipe.readline())
    except Exception as exc:  # subprocess pipes may close when killed
        output.put(f"[stdout read error: {type(exc).__name__}]")


def _shutdown(process: subprocess.Popen[str]) -> str:
    if process.poll() is None:
        process.terminate()
    try:
        stdout, stderr = process.communicate(timeout=10)
    except subprocess.TimeoutExpired:
        process.kill()
        stdout, stderr = process.communicate(timeout=10)
    # Expose failure details without printing the token or full local paths.
    return f"exit={process.returncode}; stderr={stderr[-2500:]!r}; stdout_tail={stdout[-500:]!r}"


def _json_call(url: str, token: str, route: str, *, method: str = "GET", body: dict | None = None):
    headers = {"Authorization": "Bearer " + token, "Content-Type": "application/json"}
    data = None if body is None else json.dumps(body).encode("utf-8")
    request = urllib.request.Request(url + route, headers=headers, data=data, method=method)
    with urllib.request.urlopen(request, timeout=8) as response:
        return response.status, json.load(response)


def verify(executable: Path, *, startup_timeout: float = 65) -> None:
    exe = executable.expanduser().resolve(strict=True)
    if not exe.is_file() or exe.stat().st_size < 100_000:
        raise SmokeFailure("Packaged backend is missing or unexpectedly small")
    token = secrets.token_hex(32)
    with tempfile.TemporaryDirectory(prefix="bolt-sidecar-smoke-") as tmp:
        database = Path(tmp) / "sessions.sqlite3"
        env = dict(os.environ)
        env.update(BOLT_API_TOKEN=token, BOLT_DESKTOP_CHILD="1", PYTHONUNBUFFERED="1")
        process = subprocess.Popen(
            [str(exe), "--db", str(database)], cwd=exe.parent, env=env,
            stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            text=True, encoding="utf-8", errors="replace",
            creationflags=subprocess.CREATE_NO_WINDOW if sys.platform == "win32" else 0,
        )
        assert process.stdout is not None
        line_queue: queue.Queue[str] = queue.Queue()
        threading.Thread(target=_readline, args=(process.stdout, line_queue), daemon=True).start()
        failure = None
        try:
            try:
                line = line_queue.get(timeout=startup_timeout).strip()
            except queue.Empty:
                raise SmokeFailure("Packaged backend did not emit BOLT_READY before timeout")
            match = re.fullmatch(r"BOLT_READY ([0-9]{1,5})", line)
            if match is None or not 1 <= int(match.group(1)) <= 65535:
                raise SmokeFailure(f"Unexpected packaged backend handshake: {line[:200]!r}")
            url = "http://127.0.0.1:" + match.group(1)

            for attempt in range(35):
                if process.poll() is not None:
                    raise SmokeFailure("Packaged backend exited before accepting connections")
                try:
                    urllib.request.urlopen(url + "/health", timeout=2)
                except urllib.error.HTTPError as error:
                    if error.code != 401:
                        raise SmokeFailure(f"Expected unauthenticated 401, got {error.code}")
                    break
                except (urllib.error.URLError, TimeoutError):
                    time.sleep(0.2)
                else:
                    raise SmokeFailure("Unauthenticated health endpoint was accessible")
            else:
                raise SmokeFailure("Backend never responded to unauthenticated health probe")

            code, health = _json_call(url, token, "/health")
            if code != 200 or health.get("mode") != "synthetic" or health.get("snowflake_connected") is not False:
                raise SmokeFailure("Authenticated health response is not synthetic-only")
            code, new = _json_call(url, token, "/v1/sessions", method="POST", body={})
            sid = new.get("session_id", "")
            if code != 200 or not re.fullmatch(r"[0-9a-f]{32}", sid):
                raise SmokeFailure("Session creation failed")
            _, answer = _json_call(url, token, "/v1/chat", method="POST", body={
                "session_id": sid, "question": "Show revenue by channel in 2026"})
            evidence = answer.get("evidence") or {}
            if (answer.get("status") != "ok" or not evidence.get("is_synthetic")
                    or not str(evidence.get("sql", "")).lower().startswith("select")
                    or len((answer.get("data") or {}).get("rows", [])) != 4):
                raise SmokeFailure("Authenticated synthetic revenue evidence check failed")
            _, history = _json_call(url, token, f"/v1/sessions/{sid}/turns")
            if len(history.get("turns", [])) != 2 or not database.is_file():
                raise SmokeFailure("Conversation ledger persistence failed")
            print("PASS: native packaged backend starts, rejects unauthenticated requests,"
                  " and serves synthetic revenue with query evidence and SQLite history")
        except Exception as exc:
            failure = exc
        details = _shutdown(process)
        if failure:
            raise SmokeFailure(f"{failure}; process diagnostics: {details}") from failure


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--executable", required=True, type=Path)
    parser.add_argument("--startup-timeout", type=float, default=65)
    args = parser.parse_args()
    try:
        verify(args.executable, startup_timeout=args.startup_timeout)
    except Exception as exc:
        print(f"FAILED: {exc}", file=sys.stderr)
        raise SystemExit(1)


if __name__ == "__main__":
    main()