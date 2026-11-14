# BOLT desktop build and package verification

This workflow packages the **synthetic developer demonstration**. It does not include a standalone backend, Snowflake connectivity, an LLM, or enterprise authentication. The demo FastAPI service must be started independently on `127.0.0.1:8787`; never publish the unauthenticated service on a public interface.

## Developer build

Requires Node.js 22 or later, npm, and the synthetic FastAPI service from the repository README:

```bash
cd apps/desktop
npm install
npm run verify:source
npm run build
npm start
```

`npm run build` runs TypeScript type checking, compiles React with Vite, and verifies the built HTML uses local relative JS/CSS assets and retains its CSP. `npm run verify:source` checks the Electron entry point and navigation allowlist without the npm dependencies.

## Developer packaging (not a standalone product)

```bash
npm run pack:dir
# On Windows:
npm run pack:win
# On Linux:
npm run pack:linux
```

These commands use electron-builder and place artifacts in `apps/desktop/release/`. Building a Windows installer is intended to run on a Windows host. The installer is not yet self-contained: a separate running Python API remains mandatory. Unsigned builds can trigger Windows SmartScreen warnings. Do not use a developer build with company data.

## Current verification state

The bridge's offline `bolt_api_tests` and `bolt_desktop_syntax` checks do not install npm dependencies or compile React. The new Node-only navigation regression checks can run with `npm run verify:source`, but **the Vite build, Windows packaging and GUI launch still require a networked dependency installation and a real operating-system build**. Do not claim an installer exists until those steps succeed. A committed package-lock file is needed before moving to reproducible `npm ci` CI builds.

## Next release milestone

Bundle the FastAPI service and synthetic fixture as a versioned, signed sidecar, launch it with Electron under an authenticated loopback contract, handle restarts and port conflicts, and verify a clean Windows installation. Until then, BOLT v0.1 is a development prototype.
