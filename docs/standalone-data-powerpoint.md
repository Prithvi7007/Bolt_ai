# Standalone Data Lab PowerPoint exports

Base: PR #19, merged at f8ad23ccaf1ba55205674dd5154920a8ae97c53a.

## Contract

- A calculated Data Lab answer offers Save PowerPoint alongside HTML and CSV. The exported PPTX contains editable text: finding, original question, displayed table, formula, row evidence, source filename, target, interpretation method and all caveats. It does not invent commentary, numeric results, SQL or query IDs.
- Long content is wrapped and paginated instead of silently clipped. Decks are bounded to 40 slides; oversized presentations receive a useful error and can still be exported as HTML or CSV. Formatting and table values match the displayed analysis; slides are text/table summaries, not screenshots or newly generated charts.
- Generation uses the bundled Python service over the existing authenticated loopback connection. Only the bounded analysis snapshot is passed to that local process; source CSV rows are not read or uploaded. The model and LangGraph are not called.
- The presentation endpoint exists only in authenticated standalone desktop mode. Browser and enterprise modes cannot use it. Its request rejects unknown fields, paths, URLs, raw rows and arbitrary content. It returns in-memory PPTX bytes without creating a database artifact or temporary report file.
- Electron main validates the structured export request and binary response, then uses the native Save dialog. The renderer cannot provide a file path or bytes. Cancellation writes nothing; failure leaves the answer available for retry. HTML and CSV retain their current export path.
- Tests verify the editable slide XML and relationship package, actual local calculated values, escaping, pagination without lost caveats, payload limits, private route/authentication and absence of persistence/model calls.
- The packaged Windows GUI must save and inspect a real generated PPTX through the native dialog in addition to existing HTML, CSV and LangGraph checks. Native Windows/Linux builds must pass before delivery.

Enterprise integration and activation remain outside this milestone.
