# Standalone CSV AI planning

Base: merged personal model connection (PR #16).
Scope: let a configured personal model interpret otherwise unrecognized CSV questions, then execute a validated calculation on-device.

- Deterministic questions continue without a model call.
- An explicit AI-planning option shares the question, approved target, and column names/types only. Source rows, previews, filenames and numeric observations are not uploaded.
- The model returns one structured calculation plan. The backend and renderer validate it against the actual schema and approved target.
- Only existing local descriptive calculations can execute. No SQL, arbitrary code, invented values, filters, forecasts or causal answers are introduced.
- UI shows whether model planning was used, the chosen operation, formula, actual local results and available token usage.
- Dataset replacement and target changes reset conversations and pending interpretations.
- Tests cover request privacy, incompatible/malicious plans, execution on real fixture rows, failure and deterministic-mode regressions.
- LangGraph orchestration is a later standalone milestone; this layer supplies its local calculation tools.
