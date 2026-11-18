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

## Personal model connection

In the desktop app, open **Settings → Model connection**. Enter your OpenAI-compatible base URL and model/deployment name, then choose bearer API key, APIM subscription key, or no authentication for a keyless local endpoint. Save and test the connection. Enter keys in the application, never in source code.

Keys are protected by the operating system when secure storage is available; otherwise the connection lasts only for the current session. A configured model assists Analyst planning against the existing revenue catalog. Questions and bounded context can reach the selected provider; imported CSV rows are not uploaded. In Data Lab, enable **Use AI for unfamiliar questions** to let the model propose a supported calculation from column names/types and your question. BOLT coordinates schema validation, model planning and local calculation through LangGraph, then records a status-only completion receipt. Familiar questions still avoid model calls.

See [standalone model connection](docs/standalone-model-connection.md) for scope and verification.

## Save Data Lab analyses

After calculating an answer in Data Lab, choose **Save report** for a self-contained, printable HTML report, **Export CSV** for analysis results, or **Save PowerPoint** for editable text and chart shapes. A native Save dialog lets you choose the destination each time. All formats include the question, source filename, approved target, displayed answer/table, calculation evidence and caveats. CSV values retain their display formatting; exports contain the displayed analysis rather than the source rows.

Export generation stays on-device and does not call the model. PowerPoint is built in memory by the bundled Python service; HTML and CSV are generated in Electron main. Saved reports remain on disk, while the imported CSV and unsaved Data Lab answers remain app-session data. See [local analysis exports](docs/standalone-data-exports.md), [CSV PowerPoint export](docs/standalone-data-powerpoint.md), and [LangGraph workflow](docs/standalone-langgraph-workflow.md).

## Save and reopen an analysis in BOLT

Choose **Save analysis** on a calculated Data Lab answer to create a local **.bolt** snapshot through the native Save dialog. It preserves the original question, source filename, target, displayed answer/table, full calculated chart points, calculation evidence and caveats (including applied filters). It does not contain the source CSV, schema preview, file paths, model settings or reusable execution state.

Use **Open saved analysis** in Data Lab to review that file, including after restarting the app and before importing a CSV. The saved view is labeled **not recalculated** because snapshot files can be edited outside BOLT. It does not execute calculations, change live filters/questions, or supply follow-up context. Close preview removes only the session view; the saved file stays on disk.

Opening uses a native picker and a bounded local read; malformed or unsupported files are rejected without discarding the prior preview. Saving/opening makes no backend, model or graph call. New calculations require importing the source CSV again. See [local analysis snapshots](docs/standalone-analysis-snapshots.md).

## Charts from CSV answers

Grouped totals and means show bar charts; observed date-series answers show line charts using locally calculated aggregates. Open **View chart data** to inspect all plotted values, including retained date buckets beyond the answer table preview. Date buckets use equal horizontal spacing, so the chart note discloses that elapsed gaps may differ. Existing limits and coverage caveats remain visible.

Choose **Save chart** for a standalone SVG with source and calculation evidence. HTML reports embed the chart and full chart-data table; CSV exports add chart rows at full numeric precision. PowerPoint includes editable chart shapes, the displayed answer/table, and a paginated appendix of all plotted values. Chart shapes can be edited individually; they are not embedded Excel charts. Chart generation and export make no additional model or graph call. See [CSV answer charts](docs/standalone-data-charts.md) and [PowerPoint chart exports](docs/standalone-data-powerpoint-charts.md).

## Analyze a local category subset

After approving a target, choose a categorical column and an exact nonblank value under **Analyze a subset**, then select **Apply filter**. Matching is case-sensitive after trimming surrounding whitespace. Local analysis and questions use only matching accepted rows, including grouped/date charts, correlations and missingness counts. The structural profile and source preview continue to describe the full CSV.

Answers and exports include the filter and matching/source row counts. Apply or Clear filter resets previous results and question context; changing the source or target also clears the filter. Filter values are applied on-device and are not added to model requests or graph receipts. Free-text filter expressions remain unsupported. See [local category filtering](docs/standalone-category-filter.md).

You can also select a date column and inclusive **From / Through** bounds. Either bound may be open, and date ranges can intersect the category filter. This selects observed date keys: month-only keys use the first day of that month, and monthly aggregates are never split into daily estimates. Missing/invalid filter dates are excluded before target statistics and disclosed separately. Apply/Clear, source replacement and target changes reset both filters and calculations. Bounds are not added to model requests or graph receipts. See [local date-key ranges](docs/standalone-date-filter.md).

## Follow up within a CSV calculation

Data Lab shows the current calculation scope after an answer. Short follow-ups such as **And average?**, **And by region?**, **And bottom 3?**, or **Repeat that** reuse its validated grouping and target, then calculate again locally. Use the actual categorical column name for a breakdown. A full question starts its own scope. **Clear context**, replacing the CSV, or changing the target resets reusable context.

The resolved scope appears beside the answer and in its exported methodology notes. Missing or ambiguous context asks for a complete question; filters, unsupported inference and alternate targets keep their existing checks. Follow-ups do not send previous results to the model or call the model again. Profile-derived quality summaries are not reusable numeric context. See [CSV follow-up questions](docs/standalone-data-followups.md).

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

The repository implements the BOLT v1 reference architecture with safe local and disabled-by-default enterprise paths. Safe local mode remains the default. Enterprise activation still requires organization-owned SSO/proxy configuration, approved Snowflake objects and credentials, an approved model endpoint, retention/export policy, signing certificates and a deployment owner. Those inputs are not stored in this repository.

The earlier [synthetic prototype closure](docs/impact/prototype-closure-2026-11-15.md) is retained as a milestone record, not as the end of BOLT development.

## BOLT v1 features

- **Synthetic governed metrics:** 192 generated rows, 2 regions, 4 channels and 24 months. Supported queries: revenue by month/channel/region with 2025, 2026 or recent-12-month scope.
- **Server-created SQL only:** fixed `SELECT` templates, allowlisted dimensions, parameterized dates, read-only SQLite, 100-row result limit. Unsupported or mutation-like instructions do not execute SQL.
- **Local Data Lab (v0.8/v0.9):** Open a UTF-8 CSV in the packaged desktop renderer, profile its schema and quality, approve a numeric target, and explicitly run a second streaming pass for target mean, standard deviation, range, sum, up to 12 numeric pairwise correlations, optional categorical breakdowns, and observed date-series aggregation. Source rows and preview values remain on-device. Optional AI planning shares schema only as described below. Correlations are descriptive, not causal; there is no LLM or forecasting model. Group/date cardinality and predictor checks are bounded and disclosed in the UI.
- **Ask Your Data (v1.0):** After approving a numeric target, ask supported natural-language questions directly against the imported local CSV. The deterministic router calculates real sums, averages, counts, range, correlations, grouped rankings, observed date-series aggregates, and missingness summaries with explicit formulas and row-count provenance. It rejects forecasting, causal inference, free-text date/category filters, unsupported questions and unapproved alternate metrics rather than fabricating answers. Only bounded aggregates and recent Q&A remain in renderer memory; local mode does not use an LLM or upload dataset bytes.
- **Schema-only CSV AI planning:** An optional personal-model fallback interprets otherwise unrecognized CSV questions into validated overview, sum, mean, count, range, quality, group, timeline or correlation plans. Only the question, approved target and column names/types may reach the provider. Actual answers and evidence are calculated on-device, and known unsupported forecasts, free-text filters and alternate targets remain blocked. LangGraph coordinates schema validation, planning and status-only confirmation of local execution.
- **Scoped persistence and memory:** safe local mode uses SQLite; enterprise mode requires PostgreSQL for identity-scoped conversations, bounded working state, preferences, collections, audit events and artifact indexes. Memory can be searched or erased through explicit controls.
- **Evidence inspector:** exact executed SQL, parameters, synthetic query ID, returned table, and provenance.
- **Approved-model gateway:** optional OpenAI-compatible HTTPS gateway receives only a bounded working context and semantic catalog, returns structured query plans rather than SQL, and records prompt, completion and cached-token usage when the provider reports it.
- **Governed enterprise query path:** the disabled-by-default Snowflake adapter uses server-side credentials, a read-only role, generated parameterized SELECT statements, an approved object/column policy, bounded rows/time, query tags and query-ID/source/role/freshness evidence.
- **Bounded investigations:** “why” questions compare approved channel and region dimensions with at most four queries and explicitly label associations as non-causal.
- **Editable presentations and chart exports:** Present creates 3–5 slide PPTX artifacts; verified charts export as accessible SVG files. Both include query/source evidence and save only through restricted main-process IPC.
- **Enterprise identity boundary:** remote enterprise mode refuses to start without an approved identity resolver and rejects missing proxy authentication or unauthorized role mappings.
- **Measured evaluation:** the synthetic gate reports correctness, provenance, safety and bounded context. The approved-case runner adds latency, token/cache use, query usage and orchestration metrics without emitting question content.
- **Complete analyst workspace:** Analyst, Data Lab, Explore, Present, Collections, Data Sources, Artifacts and Settings/memory controls share one desktop shell.
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
| `POST /v1/charts` | creates an evidence-stamped SVG from a stored analysis |
| `GET/POST /v1/preferences` | reads or updates identity-scoped preferences |
| `POST /v1/memory/search` | searches scoped preferences, analyses, collections and artifacts |
| `POST /v1/memory/erase` | erases scoped memory after exact confirmation |
| `GET/POST /v1/collections` | lists or creates analysis-reference collections |
| `GET /v1/data-sources` | reports governed connector state without credentials |
| `GET /v1/artifacts` | lists session-scoped artifacts |
| `GET /v1/artifacts/{id}` | returns a session-scoped artifact to trusted desktop IPC |

## Architecture

```text
Electron main (sandboxed window; private loopback bearer token)
  ├─ React workspace: Analyst | Data Lab | Explore | Present | Collections | Sources | Artifacts | Settings
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
  ├─ PostgreSQL ledger, preferences, collections, audit and artifact indexes
  ├─ query tags and scoped SVG/PPTX artifacts
  └─ optional approved HTTPS model gateway
```

## Activation boundaries

The connectors and security boundaries are implemented but are not proof of employer authorization or production readiness. Real-company-data use remains blocked until the organization supplies and approves its SSO/identity proxy, Snowflake role and semantic object, model endpoint, retention/export rules, telemetry, security review and deployment environment. The native installers are unsigned; macOS, installer lifecycle, auto-update and Linux GUI automation are not verified. The safe local mode must not be used with employer data.

## Engineering records

- Spec: `docs/superpowers/specs/2026-11-13-bolt-ai-v1-design.md`
- Slice A plan: `docs/superpowers/plans/2026-11-13-bolt-slice-a.md`
- Full v1 completion plan: `docs/superpowers/plans/2026-11-15-bolt-v1-complete.md`
- Full-design gap closure: `docs/superpowers/plans/2026-11-15-bolt-v1-full-design-gaps.md`
- Enterprise activation: `docs/enterprise-activation.md`
- V1 evaluation: `docs/impact/v1-evaluation.md`
- Impact/measurement plan: `docs/impact/prototype-metrics.md`

The prototype source is published in [Prithvi7007/Bolt_ai](https://github.com/Prithvi7007/Bolt_ai). Native CI validates Windows and Linux packaging, the authenticated bundled backend, and the packaged Windows graphical workflow with synthetic data. Keep secrets and business data out of Git.
