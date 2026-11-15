# BOLT native installers and graphical verification

The **active** GitHub Actions workflow at `.github/workflows/desktop-installers.yml` builds unsigned Windows NSIS x64 and Linux AppImage x64 packages from this synthetic-only repository. The earlier workflow template is retained in `docs/ci-examples/` for reference. The builds are not deployments or production-ready releases.

## Active native installer CI

Open [BOLT's native build workflow](https://github.com/Prithvi7007/Bolt_ai/actions/workflows/desktop-installers.yml) to view runs. Artifacts are uploaded only when the relevant platform's tests pass.

The `BOLT native desktop build and smoke test` workflow runs on PRs that change the desktop, synthetic fixture, backend or build scripts; runs on a qualifying merge to `main`; and supports manual `workflow_dispatch`. It uses hosted `windows-2022` and `ubuntu-22.04` runners with Python 3.11 and Node 22, installs the committed lockfile via `npm ci`, runs API and Electron tests, then invokes `npm run pack:win`/`pack:linux`.

Each job then executes `scripts/verify_packaged_backend.py` against the actual `resources/backend/bolt-service(.exe)` **inside the Electron output**. The smoke test checks bearer authorization, health, a synthetic revenue query with SQL evidence, and persisted session history. An unsigned NSIS `.exe` or Linux `.AppImage` is uploaded as a downloadable Actions artifact **only if all preceding checks pass**.

On Windows GitHub Actions, the packaged-backend smoke test also runs `scripts/verify_electron_gui.mjs` against the **real unpacked Electron app**. Using an isolated temporary application profile and a short-lived localhost-only DevTools connection, it checks that the synthetic analytics window renders a revenue chart, that SQL and the Data inspector are available, and that the same session survives a full application restart. The Windows artifact is uploaded only if this graphical test passes.

Linux CI still tests the bundled backend, not the graphical window. Linux GUI verification can be run manually with a display or `xvfb-run`.

## Download and review successful installer artifacts

1. Open GitHub repository **Actions** → **BOLT native desktop build and smoke test**.
2. Select a successful workflow run for the PR or commit.
3. Under **Artifacts**, download `BOLT-AI-Windows-NSIS-unsigned` or `BOLT-AI-Linux-AppImage-unsigned`.
4. Extract the ZIP, validate the build source/commit and installer checksum, then test in a disposable Windows/Linux environment before installing on a personal machine.

The artifacts are **unsigned**. Windows SmartScreen and antivirus tools can warn about unsigned installers. Do not bypass warnings on corporate endpoints; signing and reputation are later tasks.

## What a successful CI run proves (and does not)

A successful Windows job validates native packaging, authenticated bundled API responses and an actual packaged Electron window answering synthetic questions, displaying chart/SQL evidence, and restoring the same conversation after restart. Linux CI validates native packaging and bundled API responses, not the Linux GUI. Neither platform's CI verifies installer install/uninstall, accessibility, signing, auto-updates, security audits, LLM integration, or production data access.

## Run the same checks locally

Install Python build requirements, run `npm ci` in `apps/desktop`, and execute a platform-native package command. Then run:

```bash
python scripts/verify_packaged_backend.py --executable apps/desktop/release/linux-unpacked/resources/backend/bolt-service
```

On Windows, pass `apps/desktop/release/win-unpacked/resources/backend/bolt-service.exe` instead. `PyInstaller` **does not cross-compile between Linux and Windows**.