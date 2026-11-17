# Standalone CSV follow-up questions

Base: PR #21, merged at 349a7e073a30f1ec4d71d863cc5fcd19f1f0ddf6.

## Contract

- Follow-up calculations reuse only the previous validated calculation plan for the currently approved target and imported file. Context is session-only, visible and clearable; replacing the file or changing the target resets it.
- Explicitly prefixed follow-ups support switching total/sum versus average/mean while retaining categorical or date grouping; changing a categorical breakdown after a total/mean or grouped query; changing top/bottom group ranking; and repeating a calculation. Fresh explicit questions start their own scope.
- Missing, incompatible or ambiguous context produces clarification without reading the file or calling a model. Existing guards for filters, date subsets, unsupported statistics/inference and unapproved targets remain enforced. Prior plan fields are revalidated against the current schema and target; no arbitrary execution fields are accepted.
- Recognized follow-ups execute through the existing local calculator, so answers, charts, row evidence and caveats come from a new scan rather than cached values. Resolving a follow-up makes no model or LangGraph call. Unfamiliar standalone questions retain the existing optional schema-only AI path; context plans and prior result values are not added to provider requests or graph receipts.
- Successful calculated answers update the context; unsupported answers retain the last successful context. Clear context removes the active scope without erasing displayed answers. Context controls are disabled during calculation.
- Answer provenance identifies when prior context was used and shows the resolved scope. A fixed methodology note records that scope in all existing exports without changing their strict payload shape.
- Tests cover aggregation/group/ranking changes, repeated calculations, explicit-question reset, incompatible/missing context, filter/target/inference guards, model isolation, source replacement, and context provenance in exports. Packaged Windows verification must exercise an in-context calculation, clear it, verify clarification, and retain existing chart/export/model regression flows. Both native builds must pass before delivery.

No enterprise activation, source persistence or new model sharing is introduced.
