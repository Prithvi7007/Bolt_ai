# BOLT v1.2 — Verification Evidence

**Date:** 2026-11-15 (America/New_York)  
**Verified main commit:** `246eb81ca23a2511f7acb2463eb2aae1d9d8631d`  
**Post-merge workflow:** https://github.com/Prithvi7007/Bolt_ai/actions/runs/43695559428

| Check | Result | Evidence |
|---|---|---|
| Python/API/contract suite | PASS | 38 tests; one existing Starlette deprecation warning |
| Electron and local-data Node suites | PASS | 42 tests across navigation, runtime, CSV profiling, target analysis and question routing |
| TypeScript/Vite production build | PASS | Native Windows and Linux workflow jobs |
| Windows native package | PASS | Unsigned NSIS x64 artifact |
| Linux native package | PASS | Unsigned AppImage x64 artifact |
| Packaged backend | PASS | Authenticated loopback health, synthetic revenue/SQL evidence and persisted SQLite history |
| Packaged Windows Electron GUI | PASS | Analyst chart/SQL/data inspection, CSV import, target approval, local total and timeline coverage, restart persistence |
| Linux graphical UI | NOT VERIFIED | Linux CI verifies packaging and the bundled backend only |
| Install/uninstall and code signing | NOT VERIFIED | Manual installer lifecycle and signing remain outside the prototype gate |
| Snowflake, LLM, LangGraph and PPTX | NOT IMPLEMENTED | Future enterprise phases; never used by the synthetic prototype |

## Interpretation

The synthetic desktop prototype is complete and reproducible from the repository. The Windows package has been executed graphically in CI; both native packages have executed their bundled authenticated Python service. The evidence does not establish production readiness, enterprise data authorization, Linux GUI behavior, signed-installer reputation or real-model quality.

## Security boundary

The packaged Electron main process generates a private bearer token and starts the Python service on a random loopback port. The sandboxed renderer uses a restricted preload bridge and never receives the token. Synthetic Analyst data and user-selected local CSVs are separate flows. The app is not approved for company data or public hosting.
