# BOLT AI — GitHub setup

The prototype is distributed as a Git repository with a real initial commit. Its `main` branch is intended as the baseline, and future features should land on `feature/*` branches through pull requests.

## Option 1: Use the Git-ready ZIP

1. Extract `BOLT_AI_v0.1_git_repository.zip` to a folder on your computer.
2. Create a **private** empty GitHub repository named `bolt-ai` under the `Prithvi7007` account, **without** initializing a README, .gitignore, or license. This keeps the repository histories compatible.
3. Open a terminal in the extracted folder and run:

   ```bash
   git remote add origin https://github.com/Prithvi7007/bolt-ai.git
   git push -u origin main
   ```

   GitHub Desktop or SSH authentication may be used instead of HTTPS. Do not paste credentials into source files or chat.

## Option 2: Restore from the Git bundle

```bash
git clone --branch main BOLT_AI_v0.1_git.bundle bolt-ai
cd bolt-ai
git remote remove origin
git remote add origin https://github.com/Prithvi7007/bolt-ai.git
git push -u origin main
```

Create the private empty GitHub repository first. The bundle contains the history of `main` and has no remote credentials or company data.

## Recommended collaboration conventions

- Keep `main` protected and require a PR with automated checks before merge.
- Work on `feature/*` branches, e.g. `feature/snowflake-readonly-adapter`.
- Never commit `.env`, credentials, company data, or local session SQLite databases.
- Run `PYTHONPATH=services/api python -m pytest services/api/tests -q` and `python scripts/smoke_test.py` before submitting a PR.
- For v0.1, the browser preview and synthetic API work; the Electron distributable has not been compiled in this environment.
