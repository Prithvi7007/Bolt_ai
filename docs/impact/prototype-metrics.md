# BOLT — Measurable Impact Ledger

## Synthetic v0.1 (development verification only)
- Primary flow: 1 session → 2026 channel breakdown → regional follow-up → restart → persisted replay.
- Data provenance: generated CSV fixture; every computed answer includes read-only SQLite SELECT and bound dates.
- Actual LLM calls: 0 (no model integrated). Tokens saved compared with full-history model prompts: **not measurable yet**.
- Real Snowflake accesses: 0; warehouse costs: 0; no private enterprise data.
- Promotion impact: **not yet measured** — this is a prototype, not enterprise deployment.

## Experiments to run after approved model/Snowflake integration
1. Accuracy on 30+ business questions with adjudicated answers and ambiguous-business-term cases.
2. Full-history prompts vs bounded-context prompts: average input/output/cached tokens and cost per successful question.
3. First-answer latency, multi-turn resolution, SQL compilation correctness, unauthorized-query rejection.
4. Data/source evidence completeness, business metric conformance, error and uncertainty rates.
5. Task completion, minutes saved, slide-generation quality and adoption for authorized internal pilots.

Each metric should include denominator, experiment design, CI where practical, real source provenance and limitations.
