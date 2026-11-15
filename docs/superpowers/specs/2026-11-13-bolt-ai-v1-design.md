# BOLT AI — v1 Product & Engineering Design

**Status:** Repository implementation complete on 2026-11-15; enterprise activation and production approval pending  
**Date:** 2026-11-13  
**Working name:** BOLT AI  
**Working description:** AI-native decision-intelligence desktop workbench  
**Tagline:** Ask. Investigate. Prove. Present.

## Implementation record

The safe local desktop and the repository-side enterprise contracts are implemented. This includes governed query validation, a disabled-by-default Snowflake adapter, bounded structured model planning, descriptive investigations, scoped identity/audit/memory records, editable PPTX artifacts, Explore/Present desktop modes and a reproducible evaluation gate.

Implementation does not grant authorization to use employer data. Live activation still requires the open organizational decisions in Section 11: approved SSO/identity proxy, Snowflake objects and credentials, model gateway, retention/export rules, presentation branding, security review, signing and deployment ownership.

## 1. Intent

Build an enterprise-grade desktop analyst that answers natural-language business questions against governed Snowflake data, supports context-aware follow-ups, investigates trends, generates charts and presentation-ready artifacts, and does so with measurable efficiency and traceability. The goal is a useful internal product and a defensible engineering/business impact story, rather than a chatbot demo.

### Primary workflows

1. Ask "What happened to revenue last quarter?" → resolve governed revenue metric and period → show sourced summary, breakdown, SQL and data freshness.
2. Follow with "Compare in-state and out-of-state" → reuse relevant scope, not entire chat transcript → produce a comparison table and chart.
3. Ask "Why did this change?" → plan an investigation across approved dimensions, execute bounded queries, distinguish observed associations from causal claims, and report evidence and limitations.
4. Ask "Build five slides for leadership" → create an editable PPTX using chart/data artifacts and include source citations and calculation assumptions.
5. Reopen the app → remembered project preferences and prior analysis artifacts can be retrieved with access controls; fresh query is run when needed.

## 2. Goals, non-goals and anti-goals

### Goals
- Clear, accurate answers against **approved Snowflake semantic metrics** and read-only sources.
- Chain-aware multi-turn conversations with persistent memory, without re-uploading the entire transcript on every request.
- Interactive charts, analysis artifacts, and editable PowerPoint output.
- Safe enterprise deployment posture: least-privilege auth, audit trails, bounded query cost, sandboxed Electron renderer.
- Measurable accuracy, latency, Snowflake compute consumption and LLM tokens/cost per question.
- Visually polished, accessible desktop UI that supports deep analyst workflows.

### Non-goals for v1
- Unrestricted enterprise-wide data access, autonomous mutations to Snowflake, arbitrary local code execution.
- Production deployment from a personal VPS or use of non-approved hosted models for employer data.
- Autonomous writing/merging to GitHub, Excel BI replacement, or multi-tenant enterprise administration in the first slice.
- Assertion of causal explanations from observational query results.

### Anti-goals
- Answers that cannot be traced to executed SQL or governed metrics.
- Giant prompt transcripts, schema dumps or entire query result sets passed to the LLM.
- A beautiful chat UI without a working end-to-end analytics workflow.
- Hard-coded Snowflake credentials or employer data in source code/repo.

## 3. Architecture options and selection

| Option | Pros | Cons | Decision |
|---|---|---|---|
| Electron + **Python FastAPI** service + Snowflake | Leverages Python analytics, Snowflake connector, LangGraph, Plotly, python-pptx; clean trust boundary | Backend distribution/hosting complexity | **Recommended** (continuation of previously discussed design) |
| Electron + Node/TypeScript backend | Single runtime, good typed UI integration | Rebuilds existing Python analytics/presentation tooling | Not selected |
| Pure web chat platform | Easier central deployment | Misses the specifically requested desktop workspace and local artifact integration | Not selected |

For developer mode, FastAPI can run locally with a **synthetic fixture data adapter**. For organization-approved production, backend must run in an approved environment with organization SSO, approved model endpoint, Snowflake policies, and server-side credential handling. The desktop client never connects to Snowflake with embedded secrets.

```text
Electron main (secure window, IPC whitelist)
   └── React renderer: Chat | Insights | SQL Evidence | Artifacts
           │ authenticated HTTPS
           ▼
FastAPI application (server-side auth and policy enforcement)
   ├── Request router + contextual memory selector
   ├── Agent workflow (bounded tool calls / budgets)
   ├── Semantic catalog + approved metric registry
   ├── Read-only Snowflake query adapter / synthetic test adapter
   ├── Chart and PPTX artifact tools
   ├── PostgreSQL: sessions, summaries, references, audit metadata
   └── Approved model gateway (provider-configurable)
```

## 4. Agent answer contract

Each answer may return:
- `answer`: concise explanation of findings;
- `evidence`: audited query ID, Snowflake role, metric definition ID, referenced data source, data freshness and assumptions;
- `artifacts`: table, chart, presentation or file references, with access scope;
- `limitations`: uncertainty, incomplete data, ambiguous business definition and failed checks;
- `cost`: prompt/completion/cache tokens, estimated model spend, Snowflake query usage where available.

Every answer involving data must be grounded by successfully completed query results; the system must not hallucinate metrics, raw SQL execution, or created artifacts. "Unable to verify" is preferable to an invented number.

## 5. Snowflake governance and query lifecycle

1. Resolve user's business terminology through an approved semantic catalog (prefer semantic views/Cortex Analyst where policy and account capabilities permit).
2. Generate a structured query plan (`metric`, `dimensions`, `filters`, `date grain`, expected result shape).
3. Resolve SQL server-side; parse and validate via `sqlglot` or equivalent AST parser; allow only a single read-only query statement and approved objects/functions.
4. Independently enforce read-only Snowflake role and object grants; never rely on parser alone. Bound date ranges, rows, bytes/time and service execution timeout. Use parameterized values where supported.
5. Run with auditable query tag; persist query ID, normalized SQL, time, row count and provenance.
6. Deliver bounded data or a stored artifact; never send unlimited rows or PII into the model context.
7. Cache only when permission scope and freshness policy match; treat cache as scoped data with a TTL and ACL.

**Important:** The mere presence of a Snowflake connection is not authorization. Security is enforced at each layer. Initial development uses synthetic data only.

## 6. Memory and token-efficient context

### Three distinct stores

- **Conversation ledger:** full user/assistant messages in DB for audit and UI; not automatically in LLM prompt.
- **Working memory:** concise rolling summary of task intent, business definitions, constraints and active artifact/query references.
- **Retrievable knowledge:** user-approved persistent preferences, relevant past analyses, semantic catalog metadata and artifact indexes. All memory is access-scoped and erasable.

### Per-turn context construction

```text
User question
  → intent + entity resolver
  → last 2–6 relevant exchanges (bounded)
  → working summary (bounded)
  → retrieved metric schema snippets and selected prior query/artifact IDs
  → only necessary tool specifications
  → LLM
  → tool calls, compact results, evidence-backed answer
  → persist ledger + update memory asynchronously within approved runtime
```

- Use dynamic tool discovery, semantic retrieval, result summarization and provider-side prompt caching where available.
- Never equate *streaming* with token consumption: support complete-response UI and optional live-progress states, while optimizing model **input context** separately.
- Display token usage per turn and compare against a full-history baseline on representative multi-turn test scenarios.
- Do not retain sensitive literal query results in memory unless explicitly authorized; references inherit data ACLs and expiry.

## 7. Bounded orchestration tools

| Name | Input | Output | Guardrail |
|---|---|---|---|
| `discover_data` | user intent, business terms | scoped metric/table schema | allowed catalog only |
| `plan_query` | metric/dimensions/filters | reviewed query plan | dimensional compatibility |
| `execute_readonly_query` | validated plan/SQL, cost limits | query ID, result reference, compact preview | SQL validator + DB permissions |
| `analyze_result` | stored result ref, requested comparison | stats with assumptions | deterministic computation |
| `build_chart` | authorized result ref, chart spec | Plotly JSON + downloadable image | consistent labels/table fallback |
| `create_presentation` | analysis refs, deck outline | editable PPTX + slide citations | no invented claims |
| `search_memory` | scope and query | memory snippet IDs | ACL-scoped retrieval |

The orchestrator should ask clarifying questions only when the ambiguity changes a business-critical calculation; otherwise use clear defaults and expose them.

## 8. UI/UX: BOLT desktop workspace

Source: UI/UX Pro Max original catalog reasoning (`Data-Dense Dashboard`, `AI-Native UI`, `Minimalism`, desktop-native patterns), with variance 7/10, motion 4/10, density 8/10.

### Desktop information architecture

- **Left navigation (~235px):** BOLT logo, New Chat, Conversations, Collections, Data Sources, Artifacts, Settings; searchable.
- **Primary canvas (~56–65% of remaining width):** dialogue; evidence-backed answer cards; inline plots and tables; multi-turn context chips; prompt composer.
- **Right inspector (~330px, toggleable):** SQL / Evidence / Data / Artifact tabs; query ID, role, freshness, metric definitions, estimated cost, traceable steps; optional slide outline.
- **Top bar:** data source and scope, connection state, active model, session token counter, current project.
- **Navigation modes:** Chat, Explore, Present; no need for separate apps or tab overload.

### Design tokens

| Token | Value | Use |
|---|---|---|
| Background | `#0F172A` | deep navy canvas |
| Card | `#111827` | surfaces |
| Muted surface | `#1E293B` | side panels |
| Border | `#334155` | separators |
| Primary | `#1E40AF` | blue action buttons |
| Primary text | `#F8FAFC` | readable main text |
| Muted text | `#CBD5E1` | secondary labels |
| Accent | `#D97706` | amber emphasis, never white small text on amber |
| Type | Fira Sans / Fira Code | prose / SQL and numeric details |

Contrast checks performed via UI/UX Pro Max: `#F8FAFC` on `#1E40AF` = **8.337:1**; `#CBD5E1` on `#111827` = **11.948:1**; `#D97706` on `#0F172A` = **5.604:1**; **white on amber is only 3.186:1 and fails WCAG AA for normal text** — prefer dark text or amber as a non-text visual accent.

### Interaction requirements

- Desktop-first min 1024px with resizable panels; compact 768px adaptation hides inspector by default.
- Visible keyboard focus, navigable response sections, not color-only status; reduced-motion support.
- Show query progress (understanding → planning → querying → analyzing) even if token-by-token streaming is disabled.
- Offer citation/evidence alongside every metric, and a clear "View SQL" route.
- Chart fallback: accessible table with values and labels; trends as line charts, dimension comparisons as sorted bars, rates with correctly defined denominators.
- Session and result references should be visible/editable; no mysterious hidden memory changes.

## 9. MVP vertical slice and acceptance criteria

**Slice A — Foundation**
- Electron opens a secure React view, talks to a FastAPI health endpoint, handles failed connection and configuration without crashing.
- A fixed synthetic dataset and semantic metric registry allow a user to ask a question and receive a correct computed answer with query/result references.
- Persist and reopen a session; follow-up carries the correct filters and previously chosen metric without passing every past message to the model.
- A test verifies malicious/unsafe SQL is rejected, row/time limits enforced, and no secrets are in renderer process.

**Slice B — Data / chart**
- Configured Snowflake read-only adapter (disabled by default) with `SELECT` query allowlist and query audit metadata.
- Generate a chart from the same authorized result reference; chart includes descriptive title, units, source and accessible table.

**Slice C — Presentation**
- Turn selected stored analyses into 3–5 slides with an editable PPTX, chart/data references and source notes; open/download through Electron.

### Evaluation gates (targets to validate, not achieved claims)
- 0 accepted write queries across adversarial safety suite.
- ≥95% correctness on an approved, unambiguous synthetic/curated question set; report denominator and confidence interval.
- ≥40% reduction in average input tokens on representative long multi-turn conversations **versus full-history baseline**, at no significant loss in task accuracy.
- ≤10 tool invocations per typical bounded analysis; explicit safeguards for query cost/timeout.
- 100% data-derived answers show relevant query ID/source provenance, or explicit uncertainty if not verifiable.
- Test on Windows (primary), then macOS/Linux smoke tests as development access allows.

## 10. Repository and delivery rules

Proposed repo: `Prithvi7007/bolt-ai` (private). Verified on 2026-11-13: not accessible/does not exist through connected GitHub account at the time of check. Do **not** change `crew_games` or other existing repositories.

Proposed folders after approval:

```text
apps/desktop/              # Electron + React UI
services/api/              # FastAPI, auth, chat and artifact routes
packages/contracts/        # API schemas and examples
services/api/bolt/agents/  # bounded agent workflow + tool registry
services/api/bolt/data/    # Snowflake + synthetic adapters
services/api/bolt/memory/  # summary and retrieval
services/api/bolt/artifacts/# charts and presentation generators
fixtures/synthetic/       # versioned, non-proprietary demo data
tests/                    # integration and benchmark evaluation
docs/superpowers/specs/   # approved design specs
docs/superpowers/plans/   # TDD implementation plans
docs/impact/              # baselines, metrics, demos, promotion impact log
```

Protected default branch; short-lived feature branches, reviewable PRs, CI checks, no direct deployment to production. No company data or credentials in source, logs, demo decks or the promotion portfolio.

## 11. Important open decisions

1. **Execution topology:** developer-local FastAPI for synthetic testing; enterprise-approved remote backend for real Snowflake. Confirm organization's allowed deployment and model gateway before production.
2. **Company identity & access:** SSO mechanism, Snowflake role mapping, authorized warehouse/semantic views, permitted data retention, export policy.
3. **SQL intelligence:** Snowflake Cortex Analyst vs self-hosted tool calling must be evaluated on identical approved datasets.
4. **Presentation branding:** corporate design templates must be authorized before integrating them; begin with neutral themes.
5. **Approval to activate:** the repository reference implementation is complete. Real data, enterprise identity, model routing and deployment remain disabled until separate organizational approvals are supplied.

## 12. Promotion impact instrumentation

Capture before/after in `docs/impact`: average analyst minutes saved per task, question correctness, proportion supported by traceable evidence, input/output/cached token cost, Snowflake compute cost, agent tool calls, artifact generation success, user satisfaction and examples of decision impact. Avoid employer confidential numbers in public portfolio materials.

**V1 status:** Safe local mode, the disabled-by-default Snowflake and model connectors, bounded investigations, PowerPoint tools, identity/audit contracts, desktop Explore/Present flows and synthetic evaluation are implemented. Enterprise activation, real-company-data validation, native signing and production deployment are intentionally outside the repository and require the approvals above.
