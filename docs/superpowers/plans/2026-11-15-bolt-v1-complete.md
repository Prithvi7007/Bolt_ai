# BOLT AI v1 completion plan

**Spec:** docs/superpowers/specs/2026-11-13-bolt-ai-v1-design.md
**Base:** main at 9a18d92d0f39528d5034e7cb3fd5ae272999feae
**Status:** Repository implementation complete; native PR verification pending

## Completion contract

The repository-side v1 implementation is complete only when all of the following are implemented and verified:

1. Governed semantic catalog and a fail-closed read-only query policy.
2. Disabled-by-default Snowflake adapter with bounded rows, timeout, query tags, provenance and lazy credentials.
3. Optional approved OpenAI-compatible model gateway using bounded context and structured plans.
4. Bounded investigation workflow that labels associations as non-causal.
5. Full conversation ledger, bounded working memory, scoped preferences, audit events and artifact indexes.
6. Editable PPTX generation from stored analyses with source and limitation slides.
7. Desktop Explore and Present flows, artifact save IPC and capability/connection disclosure.
8. Synthetic evaluation harness reporting denominator, accuracy, provenance, safety and bounded-context reduction.
9. Native Windows/Linux build, packaged-backend smoke tests and Windows GUI verification remain green.

Actual employer SSO metadata, Snowflake credentials, approved warehouse objects, model credentials, corporate slide templates, signing certificates and deployment ownership are external configuration inputs. Code paths must fail closed when those inputs are absent.

## TDD tasks

- [x] Task 1: query governance, semantic catalog and Snowflake adapter.
- [x] Task 2: approved-model gateway and bounded orchestration/investigation.
- [x] Task 3: scoped memory, audit and artifact metadata.
- [x] Task 4: editable PPTX artifact service and API routes.
- [x] Task 5: desktop Explore/Present modes and safe artifact-save IPC.
- [x] Task 6: evaluation harness, documentation and complete verification.

## Fresh verification evidence

- Backend/API/contract suite: 64 tests passed on the final working-tree fingerprint.
- Desktop syntax/security check: passed on the same final working-tree fingerprint.
- Native Windows/Linux builds, packaged backend verification and Windows GUI verification are required on the PR head before merge.
