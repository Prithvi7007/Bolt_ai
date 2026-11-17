# Standalone LangGraph local workflow

Base: PR #17, merged at 7e01d466b97861a3a16740891b2dc989b2e672bd.
Dependency: langgraph==1.2.22, pinned for the desktop service and offline test image.

## Contract

- A real StateGraph validates schema, calls the configured planner once, validates the plan, then pauses with interrupt() for the on-device calculator.
- The renderer resumes the graph with a status-only receipt: completed, failed or cancelled. CSV rows, result values and filenames never enter graph state or receipts.
- A resumed node never repeats the model call. Duplicate matching receipts are idempotent; conflicting receipts are rejected.
- Unsupported plans terminate without dispatching a local calculation.
- Run IDs are random. Session-only checkpoints are bounded to 32 runs and expire after 30 minutes. Completed runs may be evicted first. Restarting the sidecar discards workflow state, matching the current transient CSV source.
- LangSmith tracing is explicitly disabled around execution, even when ambient tracing is enabled.
- Existing deterministic questions avoid model and graph calls. Existing schema-only planning remains available for compatibility.
- UI progress distinguishes model planning, local execution, and receipt confirmation. Local calculation values remain usable if confirmation is unavailable.
- Native Windows GUI verification must exercise the pause/resume path with the existing loopback test provider.

## Development environment

The offline bridge image needs the same pinned LangGraph dependency. The application repository includes a reviewed overlay Dockerfile; rebuild only the idle development runner and retain its previous image for rollback. The separate bridge workspace has unrelated RoadLedger edits and must not be modified.

## References

- https://docs.langchain.com/oss/python/langgraph/interrupts
- https://docs.langchain.com/oss/python/langgraph/graph-api
- https://pypi.org/project/langgraph/1.2.22/
