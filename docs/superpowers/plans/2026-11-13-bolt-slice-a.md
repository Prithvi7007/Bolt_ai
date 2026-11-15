# BOLT Slice A — Prototype Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Status:** COMPLETE — synthetic Slice A and the local CSV extensions are implemented and verified. Main commit `246eb81ca23a2511f7acb2463eb2aae1d9d8631d` passed native Windows/Linux CI on November 15, 2026.

**Goal:** Ship a runnable Electron + React desktop prototype that calls a Python FastAPI service, answers a small set of questions over synthetic revenue data, persists conversations, and exposes SQL evidence without replaying full chat history.

**Architecture:** Electron renderer calls loopback FastAPI in developer mode; Python uses a fixed-template, parameterized SQL query planner against synthetic SQLite data. A SQLite session ledger persists complete display history and a small independent working-memory state. It is a testable, provider-free prototype, not a Snowflake integration.

**Tech Stack:** Electron, Vite, React, TypeScript, Python 3.13, FastAPI, SQLite, pytest, HTTPX.

**Spec:** `docs/superpowers/specs/2026-11-13-bolt-ai-v1-design.md` (Slice A only).

## Global Constraints
- Never access corporate Snowflake or store credentials in Electron.
- Demo fixture data is completely synthetic. The SQL executor uses templates and parameters only; arbitrary SQL input is not allowed.
- Electron runs `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false` and a restricted preload bridge.
- Do not claim a model or Snowflake query executed in synthetic prototype mode; token usage reports zero actual tokens.
- No changes to unrelated GitHub repositories or production services.
- Full ledger is not sent to any language model; contextual follow-ups resolve from bounded working memory.

## Review Focus
1. **Unsupported question:** responds with explicit limitation, not fabricated statistics. Assert the 422/unsupported contract in Task 3.
2. **Unsafe SQL-like instruction:** cannot execute arbitrary SQL or mutations; verify non-execution in Tasks 1 and 3.
3. **Multiple sessions:** no memory or transcript leakage across sessions; test in Task 2.
4. **Restart:** session and history persist when API app is re-instantiated with the same SQLite path; test in Task 3.
5. **Backend outage:** the Electron renderer shows a recoverable connection failure, never fakes a healthy data source; UI check in Task 4.

---

### Task 1: Synthetic Data + Governed Query Planner
**Files:** `services/api/bolt/data.py`, `services/api/bolt/planner.py`, `fixtures/synthetic/revenue.csv`, `services/api/tests/test_data.py`

**Interfaces:**
- `resolve(question: str, memory: dict) -> QueryPlan | None` — strictly bounded metric/dimension/period routing.
- `run_query(plan: QueryPlan, connection: sqlite3.Connection) -> QueryResult` — generated SELECT templates only; SQL and parameters included as evidence.
- `load_fixture(path: Path) -> sqlite3.Connection` — seeded ephemeral SQLite connection.

- [x] Write tests for 2026 revenue monthly trend, revenue by channel, regional comparison follow-up, unsupported SQL-injection request, bounded query shape and nonnegative totals.
- [x] Run `pytest services/api/tests/test_data.py -q` and confirm expected import/behavior failures.
- [x] Implement minimum planner and fixture loader; SQL built from enum-selected templates with bound values.
- [x] Re-run the targeted tests and full suite.

### Task 2: Durable Local Session Ledger and Bounded Context
**Files:** `services/api/bolt/memory.py`, `services/api/tests/test_memory.py`

**Interfaces:**
- `SessionStore(path: Path)` with `create_session()`, `get_state(session_id)`, `append_turn(...)`, `list_turns(session_id)`, `list_sessions()`.
- `context_snapshot(session_id) -> dict` returns only active metric, dimension, previous result reference and period; never complete transcript.

- [x] Write tests for session replay, second-session isolation, persistence after store re-open, and bounded snapshot independent of number of turns.
- [x] Run tests to verify intended failures.
- [x] Implement SQLite schema and operations with parameterized statements.
- [x] Re-run tests and suite.

### Task 3: HTTP Contract + Safe Answer Engine
**Files:** `services/api/bolt/api.py`, `services/api/bolt/engine.py`, `services/api/tests/test_api.py`

**Interfaces:**
- `create_app(db_path: Path, fixture_path: Path) -> FastAPI`.
- `GET /health`, `POST /v1/sessions`, `GET /v1/sessions`, `GET /v1/sessions/{id}/turns`, `POST /v1/chat`.
- Response has `answer`, `evidence.sql`, `evidence.query_id`, `evidence.source`, `data.columns/rows`, `chart.type/labels/values`, and `cost.prompt_tokens=0` in synthetic mode.

- [x] Write API tests for health, supported question and real query evidence, follow-up resolution, unsupported questions, non-existent session, persistence across app instances, bounded row count.
- [x] Verify targeted tests initially fail for expected absence/behavior.
- [x] Implement deterministic computation and accurate narrative from returned rows; no LLM calls.
- [x] Run full backend suite with `pytest services/api/tests -q`.

### Task 4: Secure Electron + React Analyst Shell
**Files:** `apps/desktop/{package.json,index.html,vite.config.ts,tsconfig.json,src/**,electron/**}`.

**Interfaces:** React calls API over loopback (`VITE_BOLT_API_URL` default `http://127.0.0.1:8787`). UI displays history, sources, answers, a chart backed by returned values, SQL evidence, and status. Electron opens dev server or packaged frontend with sandboxed window, no Node renderer integration.

- [x] Create source checks for Electron security flags, no API keys, and no unapproved external renderer URLs.
- [x] Verify checks fail against missing shell.
- [x] Implement single-window layout following approved UI/UX Pro Max design tokens and keyboard-accessible controls.
- [x] Run source checks, TypeScript/Vite production builds, Windows NSIS and Linux AppImage packaging, authenticated packaged-backend checks, and packaged Windows Electron GUI verification.

### Task 5: Developer Handoff & Smoke Validation
**Files:** `README.md`, `.gitignore`, `docs/impact/prototype-metrics.md`, `scripts/run-api.sh`, `scripts/run-desktop.sh`, `scripts/smoke_test.py`.

- [x] Add scripted smoke scenario for create-session → question → chart/table evidence → follow-up → persisted replay.
- [x] Confirm initial missing-contract failures, then verify the API smoke path and the packaged Windows Electron GUI path.
- [x] Run the full API suite, desktop source suite, native builds, packaged-backend smoke tests, and packaged Windows GUI test.
- [x] Document results and limitations without claiming production or Snowflake/LLM functionality.

## Completion evidence

- 38 Python/API/contract tests pass; one existing Starlette deprecation warning remains.
- 42 Node tests pass across Electron navigation/runtime, CSV profiling, local analysis, and restricted question routing.
- Windows NSIS x64 and Linux AppImage x64 packages build from the committed lockfile.
- The packaged backend rejects unauthenticated requests and returns synthetic answers with SQL evidence and persisted history.
- The packaged Windows Electron GUI verifies synthetic Analyst results, CSV import, target approval, local calculations, timeline coverage, and restart persistence.
- Post-merge workflow: https://github.com/Prithvi7007/Bolt_ai/actions/runs/43695559428

## Future slices (NOT implemented here)
- B: approved Snowflake connection, query-parser validation, governance, signed query/metric registry, charts and exports.
- C: PPTX generation, artifact store, ACL-aware memory and retrieval, approved LLM gateway and bounded LangGraph workflow.
