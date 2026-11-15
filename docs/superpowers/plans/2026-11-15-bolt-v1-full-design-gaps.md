# BOLT v1 full-design gap closure

**Spec:** docs/superpowers/specs/2026-11-13-bolt-ai-v1-design.md
**Base:** main at 1b88ae9bf35c2183cd1935d1020ccc0e30bb344c
**Status:** Implementation complete; final CI verification pending

## Completion contract

The remaining repository-controlled design is complete when:

1. Enterprise mode uses PostgreSQL for sessions, bounded working state, preferences, audit records, collections and artifact indexes.
2. Memory is identity-scoped, searchable and erasable through explicit APIs.
3. Collections, data sources, artifacts and settings are functional desktop workspaces.
4. Charts can be exported as scoped downloadable SVG artifacts with evidence metadata.
5. An organization-approved benchmark can measure accuracy, provenance, latency, model tokens and query usage without storing question content.
6. All source, contract, native packaging and packaged GUI checks pass.

Organization credentials, approved data and model endpoints, corporate branding, signing certificates and deployment authorization remain activation inputs.

## Tasks

- [x] Task 1: PostgreSQL store and enterprise factory.
- [x] Task 2: scoped retrieval, preferences, erasure and collections.
- [x] Task 3: chart artifacts and complete desktop workspace navigation.
- [x] Task 4: production evaluation telemetry and documentation.
- [ ] Task 5: whole-branch review, full verification and native CI.

## Rulings

- Enterprise PostgreSQL is mandatory; SQLite remains only for safe local mode.
- SVG is the downloadable chart image format because it is accessible, deterministic, editable and requires no unsafe renderer capture.
- Destructive memory erasure requires an exact confirmation phrase and removes both database indexes and owned artifact files.
- Corporate branding remains external because using an unapproved employer template would violate the design security boundary.
