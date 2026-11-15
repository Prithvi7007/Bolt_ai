from fastapi.testclient import TestClient
import pytest

from bolt.enterprise_service import create_enterprise_app


def enterprise_env(tmp_path):
    return {
        "BOLT_DB_PATH": str(tmp_path / "enterprise.db"),
        "BOLT_ARTIFACT_PATH": str(tmp_path / "artifacts"),
        "BOLT_PROXY_TOKEN": "p" * 40,
        "BOLT_ALLOWED_ROLES": "BOLT_ANALYST,BOLT_ADMIN",
        "BOLT_SNOWFLAKE_ACCOUNT": "org-account",
        "BOLT_SNOWFLAKE_USER": "svc-bolt",
        "BOLT_SNOWFLAKE_PASSWORD": "server-secret",
        "BOLT_SNOWFLAKE_ROLE": "BOLT_READER",
        "BOLT_SNOWFLAKE_WAREHOUSE": "BOLT_WH",
        "BOLT_SNOWFLAKE_DATABASE": "ANALYTICS",
        "BOLT_SNOWFLAKE_SCHEMA": "SEMANTIC",
        "BOLT_SNOWFLAKE_SOURCE": "ANALYTICS.SEMANTIC.REVENUE",
    }


def test_enterprise_factory_requires_complete_environment(tmp_path):
    with pytest.raises(ValueError):
        create_enterprise_app({"BOLT_DB_PATH": str(tmp_path / "bad.db")})


def test_enterprise_factory_wires_identity_and_disabled_optional_model(tmp_path):
    client = TestClient(create_enterprise_app(enterprise_env(tmp_path)))
    headers = {
        "X-Bolt-User": "analyst@example.com",
        "X-Bolt-Roles": "BOLT_ANALYST",
        "X-Bolt-Proxy-Token": "p" * 40,
    }
    health = client.get("/health", headers=headers)
    assert health.status_code == 200
    assert health.json()["mode"] == "enterprise"
    assert health.json()["snowflake_connected"] is True
    assert health.json()["llm_connected"] is False
