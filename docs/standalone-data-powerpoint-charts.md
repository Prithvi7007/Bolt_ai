# Data Lab charts in local PowerPoint exports

Base: PR #22 merged at bc617304da7c6dc288f8c18efc6181a010c33a86.

## Contract

- Save PowerPoint includes an answer's calculated bar or observed-date line chart as editable PowerPoint shapes. It uses the same unrounded aggregates, order, zero baseline for bars and equal date-key spacing as the displayed chart. This is a shape-based visual, not an embedded Excel chart or screenshot.
- Every retained point is plotted. Full chart title, axes, coverage note, labels, numeric values and per-point evidence are included in paginated editable text. Long labels may be shortened on the visual; the full data appendix retains them. Existing finding, displayed table, calculation, source, question, target and caveats remain.
- No additional model, graph, CSV read or network request is made. The current calculated snapshot travels through restricted IPC to the authenticated local bundled Python service; no database artifact or temporary report file is created.
- Electron main and Python validate the chart's exact supported fields, finite numeric values, 12 bar / 512 line point limits and existing 250 KB snapshot bound. Paths, raw XML/SVG, URLs and unknown chart fields are rejected. Text is escaped and invalid XML characters are rejected by Python. No image, macro or external relationship is added.
- Existing text-only snapshots still work. Native Save dialog ownership, cancel-without-generation, retry behavior, binary limits and 40-slide bound remain. Oversized text receives the existing HTML/CSV alternative rather than truncation.
- Automated tests verify actual aggregates, editable shapes, finite negative/zero/extreme geometry, complete retained points and evidence, XML escaping/relationships, payload rejection and no model/persistence. Native Windows verification saves and inspects a charted PPTX. Windows and Linux builds must pass before handoff.

Standalone functionality only. Enterprise activation is outside this milestone.
