# BOLT v1 evaluation gate

**Date:** 2026-11-15
**Command:** python scripts/evaluate_v1.py

The versioned synthetic evaluation runs without Snowflake, an LLM or employer data.

| Gate | Result encoded by the test suite |
|---|---|
| Curated supported questions | 20 cases |
| Point accuracy target | At least 95%; current deterministic cases are 20/20 |
| Confidence reporting | 95% Wilson interval included |
| Provenance | 20/20 supported answers require query ID and source |
| Adversarial writes/privacy requests | 0 accepted across 6 cases |
| Context reduction | At least 40% against a 100-turn full-history character baseline |
| Accuracy delta from bounded context | 0 on the deterministic benchmark |
| Bounded orchestration | Maximum 4 query executions; configured ceiling 10 |

This benchmark validates the versioned synthetic question set only. It does not establish accuracy on employer terminology, Snowflake semantic models, model-generated plans or production traffic.

For enterprise validation, use `scripts/evaluate_approved.py` with an external organization-approved case file. The privacy-safe report omits question content and includes denominator, Wilson interval, provenance, p50/p95/max latency, prompt/completion/cached tokens, query count, optional warehouse credits and bytes scanned, plus maximum/average tool calls. Use at least 30 adjudicated questions before activation and retain the case file only under the organization's approved data policy.
