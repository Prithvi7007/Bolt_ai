# BOLT v0.2 — authenticated local desktop service

This change replaces the v0.1 manual-backend workflow for **Electron** with an automatically launched, loopback-only synthetic Python analytics sidecar. It does not add Snowflake, live LLMs, or corporate data access.

## Runtime flow

1. Electron creates a cryptographically random 32-byte token; only the Node main process and Python child receive it.
2. Electron starts `bolt.desktop_service` from the source checkout in development, or a bundled native `bolt-service(.exe)` in packaged builds. A per-user SQLite database is stored under Electron `userData`.
3. Python binds **127.0.0.1** on an OS-assigned port and emits only `BOLT_READY <port>` to its parent. The parent verifies authenticated health before loading the UI. No public listener or unauthenticated CORS endpoint is used in managed mode.
4. A sandboxed Electron preload exposes only `window.boltApi.request(path, options)`. The parent validates the route, method, request structure, and renderer origin, adds the bearer token, and sends loopback requests.
5. Electron terminates its child when the app quits. If startup fails or the binary is missing, startup fails closed with an error message. The legacy standalone browser preview remains in explicit development mode on port 8787, outside packaged Electron.

## Development

```bash
python -m pip install -r services/api/requirements.txt
cd apps/desktop
npm ci
npm run verify:source
npm run build
npm run dev
```

You no longer need to launch the API separately for the Electron developer experience. If necessary, set `BOLT_PYTHON` to a trusted Python interpreter containing the dependencies (on Windows, use the appropriate executable path).

## Build a standalone native package — on the target OS

PyInstaller must run on the **same operating system** as the intended executable. In the repository root:

```bash
python -m pip install -r services/api/requirements-build.txt
cd apps/desktop
npm ci
npm run pack:dir
```

`pack:dir` compiles React, builds the native Python binary with PyInstaller, verifies the sidecar exists, and packages them under Electron `release/`. For an installer, use `npm run pack:win` on Windows or `npm run pack:linux` on Linux. Do not distribute unsigned packages without explaining operating-system warnings and reviewing the generated artifacts.

## Security and limitations

- Only **synthetic** revenue from `fixtures/synthetic/revenue.csv`; no LLM or real data.
- The token is generated on each launch, sent through child environment and Electron main requests, **never** exposed to the renderer or printed to stdout.
- No arbitrary renderer HTTP URLs, SQL mutations, shell commands, or local filesystem APIs are exposed. The source-mode browser preview retains an explicitly unauthenticated development server; keep it bound to loopback and never expose it on a public host.
- Per-user SQLite conversations persist across restarts, but this is not user identity management or enterprise-level encrypted storage.
- Host packaging/installer signing, Windows launch, antivirus/SmartScreen behavior, and graphical end-to-end testing still require verification on actual target systems. A successful offline API test is not evidence an installer runs.
- The Electron parent and child currently need backend restart handling if the service dies unexpectedly; this is a future resilience task.
