# BOLT v0.1 — Verification Evidence

**Date:** 2026-11-13 (America/New_York)

| Check | Result | Evidence |
|---|---|---|
| Backend TDD suite | PASS | `PYTHONPATH=services/api pytest services/api/tests -q` — 18 passed |
| Synthetic analysis flow | PASS | `python scripts/smoke_test.py` — health → channels → regions → persisted replay |
| Python syntax | PASS | `python -m compileall -q services/api/bolt` |
| Electron main JS syntax | PASS | `node --check apps/desktop/electron/main.cjs` |
| Browser preview inline JS syntax | PASS | `node --check /tmp/bolt-preview-inline.js` (script extracted from preview) |
| React/TSX parse | PASS (syntax only) | `typescript.transpileModule` on `App.tsx`, `main.tsx`, `vite.config.ts` — no syntax errors |
| Live Python API health | PASS | `curl http://127.0.0.1:8787/health` showed synthetic mode |
| npm install / Vite build | BLOCKED | npm registry DNS `EAI_AGAIN`; no compiled Electron distributable |
| Automated GUI/browser interaction | BLOCKED | sandbox browser policy returned `net::ERR_BLOCKED_BY_ADMINISTRATOR` for file and loopback URLs |
| Snowflake, LLM, PPTX | NOT IMPLEMENTED | Future slices, not used for synthetic prototype |

**Interpretation:** Verified Python behavior and syntactic soundness of the client source; a working compiled Electron binary has not been demonstrated in this environment. The HTML preview uses the real API if run on a local machine with browser access.

**Security boundary:** demo API has no identity/authentication. Loopback-only synthetic development use, not approved for company data or public hosting.
