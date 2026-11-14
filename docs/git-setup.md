# BOLT AI — GitHub setup

The prototype is now published to the existing GitHub repository `Prithvi7007/Bolt_ai` on `feature/bolt-v01-synthetic-analyst` as draft PR #1. The repository's `main` branch already exists. Do not recreate it or attempt to push the archived bundle history over it.

## Historical offline export: Git-ready ZIP (not for pushing to the existing main)

1. Extract `BOLT_AI_v0.1_git_repository.zip` to a folder on your computer.
2. The extracted history is a standalone offline archive. To inspect it locally, open a terminal inside the extracted `bolt-ai` folder and run:

   ```bash
   git log --oneline
   git status --short
   ```

   Do not force-push this archive over the existing GitHub repository. Never paste credentials into source files or chat.

## Historical offline export: Restore from the Git bundle

```bash
git clone --branch main BOLT_AI_v0.1_git.bundle bolt-ai
cd bolt-ai
git log --oneline
git status --short
```

The bundle contains an independent archived history of `main`; it has no remote credentials or company data and should not be pushed over the existing repository.

## Recommended collaboration conventions

- Keep `main` protected and require a PR with automated checks before merge.
- Work on `feature/*` branches, e.g. `feature/snowflake-readonly-adapter`.
- Never commit `.env`, credentials, company data, or local session SQLite databases.
- Run `PYTHONPATH=services/api python -m pytest services/api/tests -q` and `python scripts/smoke_test.py` before submitting a PR.
- For v0.1, the browser preview and synthetic API work; the Electron distributable has not been compiled in this environment.
