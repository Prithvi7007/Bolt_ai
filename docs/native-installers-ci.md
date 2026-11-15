# BOLT native installers and executable smoke tests

This document proposes a GitHub Actions workflow for building **unsigned test installers** on native operating systems. The workflow is currently an **inactive template** at `docs/ci-examples/desktop-installers.yml`; CREW Development Bridge deliberately prohibits creating live `.github/workflows/` entries. It requires manual code/security review and placement into `.github/workflows/desktop-installers.yml` before it will run. No app services, real company data, or secrets are required. It is **not a deployment**.

## CI workflow — not active until manually installed

After human review, copy `docs/ci-examples/desktop-installers.yml` to `.github/workflows/desktop-installers.yml` on a reviewed branch and merge that workflow separately. Do not assume an installer exists until a GitHub Actions run finishes successfully.

The `BOLT native desktop build and smoke test` workflow runs on PRs that change the desktop, synthetic fixture, backend or build scripts; runs on a qualifying merge to `main`; and supports manual `workflow_dispatch`. It uses hosted `windows-2022` and `ubuntu-22.04` runners with Python 3.11 and Node 22, installs the committed lockfile via `npm ci`, runs API and Electron tests, then invokes `npm run pack:win`/`pack:linux`.

Each job then executes `scripts/verify_packaged_backend.py` against the actual `resources/backend/bolt-service(.exe)` **inside the Electron output**. The smoke test checks bearer authorization, health, a synthetic revenue query with SQL evidence, and persisted session history. An unsigned NSIS `.exe` or Linux `.AppImage` is uploaded as a downloadable Actions artifact **only if all preceding checks pass**.

## Download and review the installer (only after workflow activation and a successful run)

1. Open GitHub repository **Actions** → **BOLT native desktop build and smoke test**.
2. Select a successful workflow run for the PR or commit.
3. Under **Artifacts**, download `BOLT-AI-Windows-NSIS-unsigned` or `BOLT-AI-Linux-AppImage-unsigned`.
4. Extract the ZIP, validate the build source/commit and installer checksum, then test in a disposable Windows/Linux environment before installing on a personal machine.

The artifacts are **unsigned**. Windows SmartScreen and antivirus tools can warn about unsigned installers. Do not bypass warnings on corporate endpoints; signing and reputation are later tasks.

## What a successful CI run proves (and does not)

It proves native platform packaging and authenticated, bundled FastAPI backend execution with synthetic revenue. It **does not** yet prove a real graphical Electron session, Windows installer lifecycle (install/uninstall/updater), security audit, model integration, or access to production data.

## Run the same checks locally

Install Python build requirements, run `npm ci` in `apps/desktop`, and execute a platform-native package command. Then run:

```bash
python scripts/verify_packaged_backend.py --executable apps/desktop/release/linux-unpacked/resources/backend/bolt-service
```

On Windows, pass `apps/desktop/release/win-unpacked/resources/backend/bolt-service.exe` instead. `PyInstaller` **does not cross-compile between Linux and Windows**.