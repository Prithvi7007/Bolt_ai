# BOLT enterprise activation

The enterprise code path is disabled unless every required server-side setting is supplied. Activation is an organizational deployment decision, not a desktop-user setting.

## Required approvals

- Approved SSO/OIDC gateway or reverse proxy that removes untrusted identity headers and injects verified BOLT headers.
- Authorized Snowflake account, read-only role, warehouse, database, schema and semantic revenue object.
- Approved data-retention, export, artifact and audit policies.
- Approved HTTPS model endpoint and model name if model planning is enabled.
- Server secret management, TLS termination, telemetry, security review and deployment ownership.

## Runtime

Install the separate enterprise dependency set in the approved server environment:

```bash
python -m pip install -r services/api/requirements-enterprise.txt
python -m uvicorn bolt.enterprise_service:create_enterprise_app --factory --host 127.0.0.1 --port 8787
```

Do not expose this process directly to the public internet. Place it behind the approved identity proxy and TLS gateway.

## Required environment variables

| Variable | Purpose |
|---|---|
| BOLT_DB_PATH | Server-side ledger database path for the current reference implementation |
| BOLT_ARTIFACT_PATH | Server-side scoped artifact directory |
| BOLT_PROXY_TOKEN | At least 32 characters; authenticates identity-proxy requests to BOLT |
| BOLT_ALLOWED_ROLES | Comma-separated approved application roles |
| BOLT_SNOWFLAKE_ACCOUNT | Approved Snowflake account |
| BOLT_SNOWFLAKE_USER | Server-side service identity |
| BOLT_SNOWFLAKE_PASSWORD | Secret-store supplied credential; never renderer-visible |
| BOLT_SNOWFLAKE_ROLE | Independently read-only role |
| BOLT_SNOWFLAKE_WAREHOUSE | Cost-controlled warehouse |
| BOLT_SNOWFLAKE_DATABASE | Approved database |
| BOLT_SNOWFLAKE_SCHEMA | Approved schema |
| BOLT_SNOWFLAKE_SOURCE | Fully qualified approved revenue semantic object |

Optional model variables: BOLT_MODEL_ENDPOINT, BOLT_MODEL_NAME, BOLT_MODEL_TOKEN and BOLT_MODEL_TIMEOUT_SECONDS. If the endpoint is set, the model name is mandatory and non-loopback endpoints must use HTTPS.

Optional query bounds: BOLT_QUERY_TIMEOUT_SECONDS and BOLT_QUERY_MAX_ROWS. Code additionally enforces a single generated SELECT, approved objects/columns, parameterized date values and maximum configured rows.

## Identity contract

The upstream gateway supplies X-Bolt-User, X-Bolt-Roles and X-Bolt-Proxy-Token only after successful organization authentication. Missing proxy authentication returns 401; roles outside BOLT_ALLOWED_ROLES return 403. Sessions, audit events and presentation artifacts are scoped to the resolved identity.

The proxy token is defense in depth, not a replacement for SSO, network controls or TLS.
