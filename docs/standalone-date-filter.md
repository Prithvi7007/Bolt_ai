# Local date-key range filters

Base: PR #24 merged at 2861a3818081b467035c7c01bb1900b3ac8868de.

## Contract

- Data Lab's local subset controls accept an optional existing date column and inclusive From/Through ISO day bounds. Either bound may be open; at least one is required. Bounds must be real calendar dates from 1900 through 2200, ordered From <= Through. Unknown fields, expressions and non-date schema columns are rejected before question/model/file execution.
- A date range works alone or intersects with the existing exact category filter. Filtering precedes target moments, pairs, groups, timelines and matched-row missingness. The full structural profile and source preview retain their original scope.
- Matching selects records by observed date key. Source YYYY-MM keys represent the first day of that month; source day keys keep their calendar day. Slashes and surrounding source whitespace follow the existing date parser. No monthly aggregate is split into days, no timezone conversion or imputation is added, and this convention appears in controls and exported methodology.
- Missing/invalid date keys among category-matched records are excluded before target statistics and counted separately. Reports retain accepted source rows, matched rows, category/date exclusions and missing/nonnumeric targets within the matched subset. Empty ranges produce explicit empty answers, null statistics and no chart.
- Applying or clearing—including an identical reapplication—resets both calculation panels and follow-up context using the existing revision identity. Source/target changes clear both filters. Draft edits and invalid submissions preserve the last applied scope/results. Old calculations cannot publish after replacement.
- Questions, charts and existing HTML/CSV/SVG/PowerPoint exports retain exact filter constraints, the date-key convention and matching coverage. Long combined constraints must respect existing per-note/payload limits without losing the full constraints in methodology caveats.
- Date bounds, filter values and results are not automatically added to optional schema-only model requests or status-only graph receipts. All matching and generation remain local, bounded and session-only. Free-text filter/date expressions remain unsupported. No enterprise activation or source persistence is introduced.
- Tests cover day/leap/month/open bounds, category intersections, missing dates/targets, empty ranges, strict rejection before model/file use, provider isolation, follow-ups, export provenance and bounded combined metadata. Native Windows checks exercise date-only and combined ranges, invalid/reapply/clear/source reset and report saving; Windows/Linux builds and existing model/export flows must pass.
