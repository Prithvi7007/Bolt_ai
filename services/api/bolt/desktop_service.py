"""Authenticated loopback service launched as a BOLT Electron child process.

Only the randomly generated port is printed to stdout, never the bearer token.
The bearer token arrives over the parent's child-process environment.
"""
from __future__ import annotations
import argparse
import asyncio
import os
from pathlib import Path
import socket
import sys

import uvicorn
from bolt.api import create_app


def bundled_fixture() -> Path:
    bundle = getattr(sys, "_MEIPASS", None)
    if bundle:
        return Path(bundle) / "fixtures" / "synthetic" / "revenue.csv"
    return Path(__file__).resolve().parents[3] / "fixtures" / "synthetic" / "revenue.csv"


def serve(db_path: Path, fixture_path: Path, token: str) -> None:
    if len(token) < 32:
        raise ValueError("Desktop API requires an ephemeral bearer token of at least 32 characters")
    if not fixture_path.is_file():
        raise FileNotFoundError("Synthetic fixture was not bundled")
    api = create_app(db_path, fixture_path, access_token=token)
    config = uvicorn.Config(
        api, host="127.0.0.1", port=0, access_log=False, log_level="warning",
        server_header=False, proxy_headers=False,
    )
    listener = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    listener.bind(("127.0.0.1", 0))
    listener.listen(128)
    listener.setblocking(False)
    port = listener.getsockname()[1]
    server = uvicorn.Server(config)
    try:
        print(f"BOLT_READY {port}", flush=True)
        asyncio.run(server.serve(sockets=[listener]))
    finally:
        listener.close()


def main() -> None:
    token = os.environ.get("BOLT_API_TOKEN", "")
    if len(token) < 32:
        raise SystemExit("BOLT_API_TOKEN must be provided by the desktop parent")
    parser = argparse.ArgumentParser(description="BOLT authenticated desktop sidecar")
    parser.add_argument("--db", type=Path, required=True)
    args = parser.parse_args()
    serve(args.db, bundled_fixture(), token)


if __name__ == "__main__":
    main()
