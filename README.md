# ⚡ BOLT AI — Synthetic Desktop Intelligence Workbench

**Ask. Investigate. Prove. Present.**

BOLT is an Electron + React desktop intelligence workbench backed by a Python FastAPI analytics service. It combines a **synthetic chat demo** with a **local-only CSV analysis and guided question-answering lab**. It is not a live Snowflake or LLM integration. The first slice demonstrates evidence-grounded answers, persisted session history, small structured context state, charts and SQL inspection.

> **No real company data, API keys, Snowflake connection, or LLM model is included.** All screenshots, numbers, charts and examples use a generated synthetic revenue fixture.

## Download a native test build

GitHub Actions builds unsigned **Windows NSIS x64** and **Linux AppImage x64** packages from source. Successful jobs run the Python/API and Electron tests and then launch the **bundled** Python executable to verify authenticated loopback health, synthetic revenue and SQL evidence, and SQLite session history.

1. Open [BOLT native installer build runs](https://github.com/Prithvi7007/Bolt_ai/actions/workflows/desktop-installers.yml).
2. Select a **successful** run for the commit you want to test, ideally a `main` build.
3. Under **Artifacts**, download `BOLT-AI-Windows-NSIS-unsigned` or `BOLT-AI-Linux-AppImage-unsigned`, then extract the ZIP.
4. Test on a personal or disposable computer, not a managed work device.

These are **unsigned** test installers and may trigger SmartScreen or antivirus warnings. The installer currently uses version `0.1.0` from `apps/desktop/package.json`, even though the desktop runtime and packaging workflow have advanced through later development PRs. Passing CI **does not** verify full graphical launch, install/uninstall behavior, signing, auto-updates, or production readiness.

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

With Node.js 22+ and npm installed, first install the Python service requirements from the repository root (`python -m pip install -r services/api/requirements.txt`), then run:

```bash
cd apps/desktop
npm ci
npm run dev
```

This launches Vite and Electron. **Electron automatically starts and authenticates the local Python service** on a random loopback port, using a restricted preload IPC API; the React renderer never receives the bearer token. There is no need to start FastAPI separately for the Electron developer app. The standalone browser preview above still requires the manually launched development API.

For a native installer, install `services/api/requirements-build.txt` in Python, then run `npm run pack:win` (on Windows) or `npm run pack:linux` (on Linux) inside `apps/desktop`. PyInstaller must run on the target OS. See [desktop runtime details](docs/desktop-sidecar-v02.md) and [native installer verification](docs/native-installers-ci.md).

## Prototype features

- **Synthetic governed metrics:** 192 generated rows, 2 regions, 4 channels and 24 months. Supported queries: revenue by month/channel/region with 2025, 2026 or recent-12-month scope.
- **Server-created SQL only:** fixed `SELECT` templates, allowlisted dimensions, parameterized dates, read-only SQLite, 100-row result limit. Unsupported or mutation-like instructions do not execute SQL.
- **Local Data Lab (v0.8/v0.9):** Open a UTF-8 CSV in the packaged desktop renderer, profile its schema and quality, approve a numeric target, and explicitly run a second streaming pass for target mean, standard deviation, range, sum, up to 12 numeric pairwise correlations, optional categorical breakdowns, and observed date-series aggregation. No source rows or dataset bytes are sent to the synthetic FastAPI backend or any external service. Correlations are descriptive, not causal; there is no LLM or forecasting model. Group/date cardinality and predictor checks are bounded and disclosed in the UI.
- **Ask Your Data (v1.0):** After approving a numeric target, ask supported natural-language questions directly against the imported local CSV. The deterministic router calculates real sums, averages, counts, range, correlations, grouped rankings, observed date-series aggregates, and missingness summaries with explicit formulas and row-count provenance. It rejects forecasting, causal inference, date/category filters, unsupported questions and unapproved alternate metrics rather than fabricating answers. Only bounded aggregates and recent Q&A remain in renderer memory; this does not use an LLM or upload dataset bytes.
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
Electron main (sandboxed window; random bearer token held outside renderer)
  ├─ React + TypeScript analyst workspace (restricted preload IPC)
  └─ managed Python FastAPI child on a random 127.0.0.1 port
            └─ FastAPI → query intent router → allowlisted SQL templates
                       ├─ read-only synthetic SQLite fixture
                       └─ session SQLite ledger + bounded memory state
```

## Current prototype limitations

Snowflake/Cortex, live LLM calls, LangGraph execution, PPTX generation, production identity/SSO, audit policies, organizational access control, automatic queries across unknown schemas and real token optimization measurement are **future milestones**, not claimed features. Neither the preview nor the packaged synthetic prototype is suitable for real company data. Production requires approved identity, authorization, permissions, safe data connectors, model hosting, telemetry and an independent security review.

## Engineering records

- Spec: `docs/superpowers/specs/2026-11-13-bolt-ai-v1-design.md`
- Slice A plan: `docs/superpowers/plans/2026-11-13-bolt-slice-a.md`
- Impact/measurement plan: `docs/impact/prototype-metrics.md`

The prototype source is published in [Prithvi7007/Bolt_ai](https://github.com/Prithvi7007/Bolt_ai). Native CI builds and packaged-backend smoke tests validate the **synthetic** workflow, not a graphical end-to-end user session. Keep secrets and business data out of Git.
