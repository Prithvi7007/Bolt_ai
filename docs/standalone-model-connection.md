# Standalone model connection — 2026-11-16

Scope: personal model configuration and planning in the standalone desktop application, without enterprise activation.

- Desktop Settings accepts an OpenAI-compatible base URL, model, bearer/APIM/none authentication and timeout.
- Electron owns OS-protected credential storage; if secure storage is unavailable, credentials remain session-only.
- Only authenticated loopback desktop routes may configure or test the provider. Browser and enterprise deployments cannot change it.
- Model planning uses the existing validated query-plan and read-only analytics path. Questions and bounded context may reach the selected provider; local CSV bytes are not uploaded.
- Save, restore, connection-test, disconnect, redacted errors and packaged module inclusion are verified.
- Next standalone slices remain local dataset tools and LangGraph orchestration; they are not represented as complete here.
- Verification: backend regression tests, Node credential/runtime tests, TypeScript build and native packaging CI.
