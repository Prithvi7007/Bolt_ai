# Local categorical subsets in Data Lab

Base: PR #23 merged at 3bf842901bd830d69eb69b874a8263b552bbe1ce.

## Contract

- After target approval, an optional local filter selects one existing categorical column and a nonblank exact value. Matching is case-sensitive after trimming surrounding cell/value whitespace. Apply changes the calculation scope; Clear filter restores all accepted rows. Draft edits do not affect results until applied.
- The filter applies before target moments, correlations, groups, observed-date buckets and question missingness counts. It never changes the full-file structural profile or five-row source preview. Missing/nonnumeric targets and malformed source rows remain separately disclosed.
- Answers and local-analysis results report the matching accepted rows, all accepted source rows and excluded target rows. Zero matches give a clear empty result without fabricated zeros or charts. Questions, charts and every existing export retain the applied filter and coverage as calculation evidence/caveats.
- Applying/clearing a filter, replacing the source, or changing the target resets prior results and question context. Old asynchronous calculations cannot publish into the replacement scope. Source/target changes clear the active filter. A fresh full question and short follow-up both use the currently applied filter.
- Filter objects contain only column/value, use exact schema names, reject unknown fields/noncategorical columns/blank or oversized values (1,000 raw characters / 1,200 serialized characters), and cannot carry expressions, SQL or arbitrary execution. Existing natural-language subset/date/inference guards remain; users select the subset through the controls.
- All matching and calculation stay in the local streaming pass with bounded state. Filter values, matched rows and results never enter schema-only model planning or graph receipts. Exports use the existing validated snapshot; no source persistence or enterprise activation is introduced.
- Tests cover scalar, pairwise, group/date and missingness results; counts/zero matches/target missingness; exact/case-sensitive matching; invalid filters before model/file execution; follow-ups and exports; stale results; and packaged Windows filter/apply/clear/source-reset behavior. Native Windows/Linux builds and existing export/model flows must pass.
