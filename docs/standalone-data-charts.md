# Standalone CSV answer charts

Base: PR #20, merged at 00a09e8605eb9cacb315af286dcbf16cf776c507.

PowerPoint support is extended by [PowerPoint chart exports](standalone-data-powerpoint-charts.md). The text-only PowerPoint clause below records the original chart milestone.

## Contract

- Categorical totals/means and observed date-series answers include charts built from the same local calculation, using numeric aggregates directly rather than parsing formatted answer text. Scalar/unsupported answers remain text/table results.
- Group charts show the same individual categories/ranking as the result table, with disclosed limits and no combined-overflow category pretending to be a winner. Date charts include all retained date buckets (up to 512); omitted date/group coverage and missingness remain disclosed.
- Bar axes include zero and support negative, mixed-sign and zero values. Line charts use equally spaced, ordered observed buckets and explicitly disclose that horizontal spacing is not elapsed time. No imputation, forecasting, or invented currency units are introduced. Nonfinite values do not produce a misleading partial chart.
- Every chart has accessible labels and an expandable full chart-data table. Existing answer tables and calculation/row evidence remain available. Chart geometry uses unrounded calculated values; chart-data CSV rows preserve numeric precision separately from the formatted answer table.
- A shared pure module supplies chart geometry to React and deterministic SVG export. Save chart (.svg) uses the native dialog. HTML reports embed the chart and full chart-data table; CSV exports include chart values, labels and coverage notes. SVG contains source/question/target/calculation/evidence/caveats, no scripts, remote assets or active user content.
- Structured bounded IPC validates chart metadata/points and finite numeric values; paths, raw SVG, arbitrary markup and extra fields remain rejected. Charts never enter model requests or LangGraph receipts. HTML/CSV/SVG generation stays in Electron main.
- PowerPoint remains the existing editable text-slide export of the displayed answer/table; chart payloads are omitted from that format and rejected by its strict private endpoint. No silent presentation-format change is introduced.
- Tests cover calculation-to-chart numeric fidelity, caps, negative/zero/extreme values, malformed payloads and escaping, native SVG/HTML saving, existing export regressions, and packaged Windows/Linux builds.

No enterprise activation or persistent CSV storage is added.
