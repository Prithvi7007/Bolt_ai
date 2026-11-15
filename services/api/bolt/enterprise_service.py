"""Factory for an organization-hosted BOLT API behind an approved identity proxy."""
from __future__ import annotations
import os
from pathlib import Path
from collections.abc import Mapping

from .api import create_app
from .auth import EnterpriseIdentityResolver
from .model_gateway import GatewayConfig, OpenAICompatibleGateway
from .snowflake_adapter import SnowflakeConfig, SnowflakeQueryAdapter


_REQUIRED = (
    "BOLT_DB_PATH",
    "BOLT_ARTIFACT_PATH",
    "BOLT_PROXY_TOKEN",
    "BOLT_ALLOWED_ROLES",
    "BOLT_SNOWFLAKE_ACCOUNT",
    "BOLT_SNOWFLAKE_USER",
    "BOLT_SNOWFLAKE_PASSWORD",
    "BOLT_SNOWFLAKE_ROLE",
    "BOLT_SNOWFLAKE_WAREHOUSE",
    "BOLT_SNOWFLAKE_DATABASE",
    "BOLT_SNOWFLAKE_SCHEMA",
    "BOLT_SNOWFLAKE_SOURCE",
)


def create_enterprise_app(environ: Mapping[str, str] | None = None):
    env = dict(os.environ if environ is None else environ)
    missing = [key for key in _REQUIRED if not env.get(key, "").strip()]
    if missing:
        raise ValueError("Missing enterprise configuration: " + ", ".join(missing))
    roles = frozenset(
        item.strip() for item in env["BOLT_ALLOWED_ROLES"].split(",") if item.strip()
    )
    identity = EnterpriseIdentityResolver(
        proxy_token=env["BOLT_PROXY_TOKEN"],
        allowed_roles=roles,
    )
    snowflake = SnowflakeQueryAdapter(SnowflakeConfig(
        enabled=True,
        account=env["BOLT_SNOWFLAKE_ACCOUNT"],
        user=env["BOLT_SNOWFLAKE_USER"],
        password=env["BOLT_SNOWFLAKE_PASSWORD"],
        role=env["BOLT_SNOWFLAKE_ROLE"],
        warehouse=env["BOLT_SNOWFLAKE_WAREHOUSE"],
        database=env["BOLT_SNOWFLAKE_DATABASE"],
        schema=env["BOLT_SNOWFLAKE_SCHEMA"],
        source_object=env["BOLT_SNOWFLAKE_SOURCE"],
        timeout_seconds=int(env.get("BOLT_QUERY_TIMEOUT_SECONDS", "30")),
        max_rows=int(env.get("BOLT_QUERY_MAX_ROWS", "100")),
    ))
    gateway = None
    if env.get("BOLT_MODEL_ENDPOINT"):
        gateway = OpenAICompatibleGateway(GatewayConfig(
            endpoint=env["BOLT_MODEL_ENDPOINT"],
            model=env.get("BOLT_MODEL_NAME", ""),
            token=env.get("BOLT_MODEL_TOKEN", ""),
            timeout_seconds=int(env.get("BOLT_MODEL_TIMEOUT_SECONDS", "30")),
        ))
    return create_app(
        Path(env["BOLT_DB_PATH"]),
        artifact_path=Path(env["BOLT_ARTIFACT_PATH"]),
        query_adapter=snowflake,
        model_gateway=gateway,
        identity_resolver=identity,
    )
