# Standalone Data Lab answer exports

Base: merged LangGraph workflow, PR #18 (6ac478789f451949c4f5098a612210db20f8f376).

## Contract

- Each calculated Data Lab answer offers Save report (.html) and Save results (.csv). Unsupported questions have no export controls.
- Exports contain the original question, source filename, approved target, displayed answer/table, calculation, row evidence, interpretation method and every limitation. They are snapshots of the displayed answer, not full CSV extracts or additional calculations. Formatted values keep their displayed precision.
- The HTML report is a self-contained printable document with no scripts, remote assets or active source content. CSV fields are quoted and formula-like text is neutralized for spreadsheet use; negative numeric values remain numeric.
- A dedicated main-frame IPC accepts only bounded structured fields. The main process generates the file; the renderer cannot supply paths, arbitrary HTML, bytes or URLs. Every save uses the native Save dialog and its selected destination. Cancellation never writes a file. Write failures remain visible and allow retry.
- No backend, provider, graph, database or automatic persistence participates in export. Exporting an AI-planned answer does not call the model again. Explicitly exported reports remain on disk; the CSV source and app-session answers are otherwise transient.
- Native Windows GUI verification must save a real synthetic CSV answer through the native dialog and check its content; unit tests cover escaping, spreadsheet formulas, payload limits, cancellation and write failure.

This extends the standalone Ask / Prove workflow without enterprise activation. Editable presentation generation from imported CSV answers is described in [CSV PowerPoint exports](standalone-data-powerpoint.md), which uses the bundled local service for in-memory PPTX generation.
