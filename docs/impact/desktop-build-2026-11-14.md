# BOLT v0.1 — verified desktop build (2026-11-14)

This report records an actual isolated build, not a code review or a simulated build.

## Environment and command sequence

- Repository feature branch: `feature/bolt-v01-synthetic-analyst`
- Source commit that was built: `bb6104dbe1ecfa41d974afa6f01fa2d8b6e73c71`
- Isolated disposable Docker container: non-root UID 10002, no mounted credentials, one CPU, 2 GiB memory, read-only container root
- Node.js: v22.23.4; npm: 10.9.9
- Package installation: `npm install --package-lock-only --ignore-scripts --no-audit --no-fund`, then `npm ci --no-audit --no-fund` (401 packages)
- Source verification: `npm run verify:source` — 3 navigation tests passed, Electron entry-point syntax check passed
- Renderer: `npm run build` — TypeScript `tsc --noEmit` and Vite v6.4.6 production compilation passed; 1,574 modules transformed
- Renderer assets: local relative JS/CSS and Content Security Policy verification passed
- Packaging: `npm run pack:dir` — electron-builder v26.18.0 produced `release/linux-unpacked` using Electron v33.4.11
- Existing Bridge sandbox gate on final lockfile fingerprint: 22 Python API and source-contract tests passed (1 Starlette deprecation warning), Electron syntax passed
- Generated `apps/desktop/package-lock.json` SHA-256: `cea5d1c88c87883637a8d0980bd3018cfbb369b11faabffc4015bc7e4f6df1`
- Lockfile commit: `f93cfa5b5d3f627d67602a62f9c76e9fb7dfed3c`

## Important boundaries

The Linux unpacked package was produced inside a **disposable validation workspace**, not published as a release artifact. A graphical application launch was **not performed**. Neither an installable Windows `.exe` nor Linux AppImage has been verified. The app is **not standalone**: FastAPI is currently launched separately on the local machine.

There is no bundled Python service, live Snowflake or LLM connection, enterprise authentication, or use of private data. Do not expose the unauthenticated API to a public network.

This successful build demonstrates that the TypeScript renderer compiles and Electron packaging succeeds under Linux x64. It does **not** yet establish complete end-to-end desktop functionality.

## Subsequent milestone

1. Automate `npm ci`, navigation tests, Vite build, and Electron packaging in CI with the committed lockfile.
2. Build and run a Windows installer in an isolated Windows environment.
3. Add a local authenticated, automatically launched Python backend sidecar and app-startup recovery.
4. Verify an end-to-end session using the packaged app against synthetic data.

No production deployment or main-branch merge was performed during this verification.
