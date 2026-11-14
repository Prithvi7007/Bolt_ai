#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
python -m uvicorn bolt.api:app --app-dir services/api --host 127.0.0.1 --port 8787
