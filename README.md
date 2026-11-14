# ⚡ BOLT AI — v0.1 Synthetic Prototype

**Ask. Investigate. Prove. Present.**

BOLT is an Electron + React desktop intelligence workbench backed by a Python FastAPI analytics service. This is a **working synthetic-data prototype**, not a live Snowflake or LLM integration. The first slice demonstrates evidence-grounded answers, persisted session history, small structured context state, charts and SQL inspection.

> **No real company data, API keys, Snowflake connection, or LLM model is included.** All screenshots, numbers, charts and examples use a generated synthetic revenue fixture.

## See the prototype (fastest path)

Requirements: Python 3.11+ with pip. Run from repository root:

```bash
python -m pip install -r services/api/requirements.txt
python -m uvicorn bolt.api:app --app-dir services/api --host 127.0.0.1 --port 8787
```

Then **open `apps/desktop/preview.html` in a browser**. This is a dependency-free, interactive frontend preview that calls the same FastAPI endpoints as the Electron React renderer. The API must remain running. You can click the suggested questions, ask follow-ups, switch sessions, inspect the actual SQLite SELECT statements, and view the chart/data table.

If your browser blocks `file://` → loopback HTTP, serve the project locally in a second terminal:

```bash
python -m http.server 8080 --bind 127.0.0.1
```

Then open `http://127.0.0.1:8080/apps/desktop/preview.html`.

## Run the actual Electron desktop app

With Node.js 22+ and npm installed, start FastAPI as above. In a second terminal:

```bash
cd apps/desktop
npm install
npm run dev
```

This launches Vite on localhost and then Electron. On Windows PowerShell, use the same commands in separate PowerShell windows. `npm run build` builds the React renderer, and `npm start` starts Electron against the built `dist/index.html` (with the API running).

**Build verification limitation:** The authoring environment cannot access the npm registry, so React/Electron packages could not be installed or built here. The Python backend and browser preview were verified independently. Do not treat the Electron distributable as built or tested.

## Prototype features

- **Synthetic governed metrics:** 192 generated rows, 2 regions, 4 channels and 24 months. Supported queries: revenue by month/channel/region with 2025, 2026 or recent-12-month scope.
- **Server-created SQL only:** fixed `SELECT` templates, allowlisted dimensions, parameterized dates, read-only SQLite, 100-row result limit. Unsupported or mutation-like instructions do not execute SQL.
- **Persistent conversation history:** SQLite stores full transcript for display, distinct from a compact working-memory snapshot used to resolve follow-ups.
- **Evidence inspector:** exact executed SQL, parameters, synthetic query ID, returned table, and provenance.
- **Token honesty:** no LLM is used in this slice; measured LLM tokens and calls are 0. True token benchmarking starts when a model is integrated.
- **Visualizations:** chart types from server responses, shown as accessible SVG/CSS graphics with data table fallback.
- **Electron hardening:** `contextIsolation`, renderer sandboxing, disabled Node integration, blocked arbitrary navigation/windows.

## Test commands

```bash
python -m pip install -r services/api/requirements.txt
python -m pip install pytest httpx
PYTHONPATH=services/api pytest services/api/tests -q
python scripts/smoke_test.py
```

## API contract

| Endpoint | Operation |
|---|---|
| `GET /health` | shows explicit `synthetic` status |
| `POST /v1/sessions` | creates conversation |
| `GET /v1/sessions` | lists conversations |
| `GET /v1/sessions/{id}/turns` | retrieves persisted UI history |
| `POST /v1/chat` | accepts `{ "session_id": "...", "question": "..." }` |

## Architecture

```text
Electron main (sandboxed window; no database credentials)
  └─ React + TypeScript analyst workspace
       └─ http://127.0.0.1:8787 (developer-local, synthetic only)
            └─ FastAPI → query intent router → allowlisted SQL templates
                       ├─ read-only synthetic SQLite fixture
                       └─ session SQLite ledger + bounded memory state
```

## What is *not* in v0.1

Snowflake/Cortex, live LLM calls, LangGraph execution, PPTX generation, production identity/SSO, audit policies, organizational access control, automatic queries across unknown schemas and real token optimization measurement are **future milestones**, not claimed features. The preview is not suitable for real company data. Production requires a server-side authorization model, CORS hardening, approved identity, permissions, secure transport and approved model hosting.

## Engineering records

- Spec: `docs/superpowers/specs/2026-11-13-bolt-ai-v1-design.md`
- Slice A plan: `docs/superpowers/plans/2026-11-13-bolt-slice-a.md`
- Impact/measurement plan: `docs/impact/prototype-metrics.md`

The prototype source is published in `Prithvi7007/Bolt_ai` on the `feature/bolt-v01-synthetic-analyst` branch for review in draft PR #1. This is source code, not a deployed application or compiled Electron release. Keep secrets and business data out of Git.
