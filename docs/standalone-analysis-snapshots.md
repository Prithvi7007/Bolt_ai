# Local analysis snapshot files

Base: PR #25 merged at d46f4ac75f23648d750359de77beefe88ba994c9.

## Contract

- A calculated Data Lab answer offers Save analysis. It writes a versioned UTF-8 JSON .bolt file through the existing native Save dialog, containing only the original source filename, approved target, question, interpretation label and calculated answer/table/chart/evidence/caveats plus kind/version/save time. The full source CSV, profile/preview, file paths, model settings, keys, graph receipts, reusable plans and conversation history are not included.
- Open saved analysis is available in Data Lab before importing a CSV. A native Open dialog is the sole source of a file path; the renderer cannot supply paths, bytes or URLs for opening. Main-process reading is bounded to 300,000 bytes and regular files, with a bounded read even if file size changes. Invalid encoding/JSON/version/fields/metadata/oversized or malformed charts are rejected before rendering.
- The saved schema reuses the existing bounded analysis snapshot fields (250,000-byte compact input; 512 table rows; 40 caveats; finite 12-bar/512-line chart points). Exact root/result/chart keys reject extra execution/configuration fields. Text remains inert, and no linked content or code is executed.
- Reopened contents are visibly labeled as a saved, unauthenticated snapshot that was not recalculated. The view retains the original question/source/target/save time, chart, full chart-data view, displayed table, formula, evidence and all caveats. It offers review and Close preview; it does not feed saved plans/results into questions, execute a calculation, or offer fresh-result export actions.
- Opening, cancelling, closing or rejecting a file does not change the live CSV, approvals, applied filters, calculation results or question context. A failed open retains the previous saved preview. The preview is session-only; the saved .bolt file can be reopened after an app restart without reimporting the CSV.
- Saving/opening makes no backend/model/graph/network call and does not automatically write to SQLite, preferences, artifact indexes or source storage. Existing HTML/CSV/SVG/PowerPoint and personal model flows remain.
- Tests cover round-trip fidelity, chart/numeric limits, strict schema/version/encoding/size rejection, bounded/partial reads and cleanup, native-selected path/cancellation, preload argument rejection, absence of source/configuration payloads, and packaged Windows save/open/restart review with live-state isolation. Windows/Linux builds and existing packaged flows must pass.

Standalone functionality only. This is saved-analysis review, not resumption of a live dataset project; new calculations require importing the CSV again.
