# BOLT Synthetic Prototype Closure

**Closed:** November 15, 2026  
**Repository:** https://github.com/Prithvi7007/Bolt_ai  
**Verified main:** `246eb81ca23a2511f7acb2463eb2aae1d9d8631d`  
**CI evidence:** https://github.com/Prithvi7007/Bolt_ai/actions/runs/43695559428

## Outcome

The synthetic Bolt desktop prototype is complete. It is a native Electron + React application with an authenticated local FastAPI sidecar, deterministic synthetic analytics, persisted conversation history, SQL evidence, charts, and a local-only CSV Data Lab. Windows and Linux packages build from the committed lockfile. The packaged Windows application runs its main Analyst and Data Lab scenarios in CI.

## Completed scope

| Area | Delivered |
|---|---|
| Analyst | Governed synthetic revenue questions, bounded follow-ups, chart/table responses and exact SQL evidence |
| Memory | Durable SQLite transcript plus compact structured context, with session isolation and restart persistence |
| Desktop | Sandboxed Electron renderer, restricted preload IPC, random loopback sidecar port and private bearer token |
| Data Lab | Streaming UTF-8 CSV profile, schema/missingness diagnostics, human target approval and bounded descriptive analysis |
| Ask Your Data | Local rule-based sums, means, counts, ranges, correlations, grouped rankings and observed-date summaries |
| Evidence | Row counts, formulas, exclusions, cardinality limits, date coverage and explicit unsupported-request responses |
| Packaging | Unsigned Windows NSIS x64 and Linux AppImage x64 artifacts |
| Verification | 38 Python/API/contract tests, 42 Node tests, packaged backend checks and packaged Windows GUI execution |

## Explicitly outside the completed prototype

- Live LLM or LangGraph orchestration
- Snowflake/Cortex or other company-data access
- Natural-language generation of arbitrary SQL
- Forecasting, causal claims or model training
- PPTX/artifact generation
- SSO, enterprise authorization, audit policy and organizational ACLs
- Code signing, auto-update, production deployment and Linux GUI automation

These are separate enterprise phases. They require a provider/model decision, approved credentials and data sources, identity/authorization requirements, retention/export policy, and a new reviewed implementation plan. They are not unfinished defects in the synthetic prototype.

## Resume gate

Do not connect real data or a hosted model by editing the prototype ad hoc. Start a new phase only after recording:

1. Approved model endpoint and credential-handling boundary.
2. Approved data source, semantic layer and read-only role.
3. Identity, authorization, audit and retention requirements.
4. Evaluation dataset and acceptance thresholds.
5. Deployment owner and target environment.

Until those decisions exist, `main` is the stable synthetic prototype baseline.
