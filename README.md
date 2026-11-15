# ⚡ BOLT AI — Decision Intelligence Workbench

**Ask. Investigate. Prove. Present.**

BOLT is an Electron + React desktop intelligence workbench backed by Python FastAPI. The safe local mode provides synthetic and local-CSV analytics. The enterprise service implements a disabled-by-default Snowflake adapter, approved-model gateway, bounded investigations, scoped identity/audit records, editable PowerPoint artifacts and measurable evaluation gates.

> **No real company data, credentials or employer configuration is included.** The repository runs in synthetic mode unless an organization supplies approved identity-proxy, Snowflake, model, retention and deployment settings. Missing enterprise settings fail closed.

## Download a native test build

GitHub Actions builds unsigned **Windows NSIS x64** and **Linux AppImage x64** packages from source. Successful jobs run the Python/API and Electron tests and then launch the **bundled** Python executable to verify authenticated loopback health, synthetic revenue and SQL evidence, and SQLite session history.

1. Open [BOLT native installer build runs](https://github.com/Prithvi7007/Bolt_ai/actions/workflows/desktop-installers.yml).
2. Select a **successful** run for the commit you want to test, ideally a `main` build.
3. Under **Artifacts**, download `BOLT-AI-Windows-NSIS-unsigned` or `BOLT-AI-Linux-AppImage-unsigned`, then extract the ZIP.
4. Test on a personal or disposable computer, not a managed work device.

These are **unsigned** test installers and may trigger SmartScreen or antivirus warnings. The desktop package is version `1.2.0`. Windows CI launches the packaged Electron application and verifies the synthetic Analyst and local CSV Data Lab flows. CI does not verify installer install/uninstall behavior, signing, auto-updates, Linux GUI behavior, or production readiness.

## Run the safe local mode

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

## BOLT v1 implementation status

The repository-side BOLT v1 design is implemented on the full-v1 feature branch. Safe local mode remains the default. Enterprise activation still requires organization-owned SSO/proxy configuration, approved Snowflake objects and credentials, an approved model endpoint, retention/export policy, signing certificates and a deployment owner. Those inputs are not stored in this repository.

The earlier [synthetic prototype closure](docs/impact/prototype-closure-2026-11-15.md) is retained as a milestone record, not as the end of BOLT development.

## BOLT v1 features

- **Synthetic governed metrics:** 192 generated rows, 2 regions, 4 channels and 24 months. Supported queries: revenue by month/channel/region with 2025, 2026 or recent-12-month scope.
- **Server-created SQL only:** fixed `SELECT` templates, allowlisted dimensions, parameterized dates, read-only SQLite, 100-row result limit. Unsupported or mutation-like instructions do not execute SQL.
- **Local Data Lab (v0.8/v0.9):** Open a UTF-8 CSV in the packaged desktop renderer, profile its schema and quality, approve a numeric target, and explicitly run a second streaming pass for target mean, standard deviation, range, sum, up to 12 numeric pairwise correlations, optional categorical breakdowns, and observed date-series aggregation. No source rows or dataset bytes are sent to the synthetic FastAPI backend or any external service. Correlations are descriptive, not causal; there is no LLM or forecasting model. Group/date cardinality and predictor checks are bounded and disclosed in the UI.
- **Ask Your Data (v1.0):** After approving a numeric target, ask supported natural-language questions directly against the imported local CSV. The deterministic router calculates real sums, averages, counts, range, correlations, grouped rankings, observed date-series aggregates, and missingness summaries with explicit formulas and row-count provenance. It rejects forecasting, causal inference, date/category filters, unsupported questions and unapproved alternate metrics rather than fabricating answers. Only bounded aggregates and recent Q&A remain in renderer memory; this does not use an LLM or upload dataset bytes.
- **Persistent conversation history:** SQLite stores full transcript for display, distinct from a compact working-memory snapshot used to resolve follow-ups.
- **Evidence inspector:** exact executed SQL, parameters, synthetic query ID, returned table, and provenance.
- **Approved-model gateway:** optional OpenAI-compatible HTTPS gateway receives only a bounded working context and semantic catalog, returns structured query plans rather than SQL, and records prompt, completion and cached-token usage when the provider reports it.
- **Governed enterprise query path:** the disabled-by-default Snowflake adapter uses server-side credentials, a read-only role, generated parameterized SELECT statements, an approved object/column policy, bounded rows/time, query tags and query-ID/source/role/freshness evidence.
- **Bounded investigations:** “why” questions compare approved channel and region dimensions with at most four queries and explicitly label associations as non-causal.
- **Editable presentations:** the Present workspace creates 3–5 slide PPTX artifacts from stored analyses, including query IDs, sources, assumptions and limitations; the renderer can save them only through a restricted main-process IPC action.
- **Enterprise identity boundary:** remote enterprise mode refuses to start without an approved identity resolver and rejects missing proxy authentication or unauthorized role mappings.
- **Measured evaluation:** a reproducible 20-question synthetic benchmark reports accuracy with a Wilson interval, provenance coverage, adversarial write rejection, bounded-context reduction and maximum tool calls.
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
| `GET /health` | reports mode, version, connector states and capabilities |
| `GET /v1/catalog` | lists approved semantic metrics and compatible dimensions |
| `POST /v1/sessions` | creates an identity-scoped conversation |
| `GET /v1/sessions` | lists identity-scoped conversations |
| `GET /v1/sessions/{id}/turns` | retrieves the persisted conversation ledger |
| `POST /v1/chat` | executes a bounded evidence-backed question or investigation |
| `POST /v1/presentations` | creates an editable PPTX from stored analyses |
| `GET /v1/artifacts` | lists session-scoped artifacts |
| `GET /v1/artifacts/{id}` | returns a session-scoped artifact to trusted desktop IPC |

## Architecture

```text
Electron main (sandboxed window; private loopback bearer token)
  ├─ React workspace: Analyst | Data Lab | Explore | Present
  ├─ restricted request and artifact-save IPC
  └─ safe local FastAPI sidecar on random 127.0.0.1 port
       ├─ synthetic read-only SQLite adapter
       ├─ bounded working memory + complete conversation ledger
       ├─ association investigation workflow
       └─ editable PPTX artifact service

Organization-hosted FastAPI (separate approved runtime)
  ├─ trusted SSO/identity-proxy boundary + role mapping
  ├─ semantic catalog and structured model plans
  ├─ fail-closed Snowflake read-only adapter
  ├─ query tags, audit events and scoped artifact indexes
  └─ optional approved HTTPS model gateway
```

## Activation boundaries

The connectors and security boundaries are implemented but are not proof of employer authorization or production readiness. Real-company-data use remains blocked until the organization supplies and approves its SSO/identity proxy, Snowflake role and semantic object, model endpoint, retention/export rules, telemetry, security review and deployment environment. The native installers are unsigned; macOS, installer lifecycle, auto-update and Linux GUI automation are not verified. The safe local mode must not be used with employer data.

## Engineering records

- Spec: `docs/superpowers/specs/2026-11-13-bolt-ai-v1-design.md`
- Slice A plan: `docs/superpowers/plans/2026-11-13-bolt-slice-a.md`
- Full v1 completion plan: `docs/superpowers/plans/2026-11-15-bolt-v1-complete.md`
- Enterprise activation: `docs/enterprise-activation.md`
- V1 evaluation: `docs/impact/v1-evaluation.md`
- Impact/measurement plan: `docs/impact/prototype-metrics.md`

The prototype source is published in [Prithvi7007/Bolt_ai](https://github.com/Prithvi7007/Bolt_ai). Native CI validates Windows and Linux packaging, the authenticated bundled backend, and the packaged Windows graphical workflow with synthetic data. Keep secrets and business data out of Git.
