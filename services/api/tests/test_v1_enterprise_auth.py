from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from bolt.api import create_app
from bolt.auth import EnterpriseIdentityResolver


FIXTURE = Path(__file__).resolve().parents[3] / "fixtures" / "synthetic" / "revenue.csv"


class UnusedAdapter:
    def execute(self, plan, actor_id):
        raise AssertionError("query should not execute in this test")


def headers(user="analyst-1", roles="BOLT_ANALYST"):
    return {
        "X-Bolt-User": user,
        "X-Bolt-Roles": roles,
        "X-Bolt-Proxy-Token": "p" * 40,
    }


def test_enterprise_mode_refuses_to_start_without_identity_resolver(tmp_path):
    with pytest.raises(ValueError, match="identity"):
        create_app(
            tmp_path / "bolt.db",
            FIXTURE,
            query_adapter=UnusedAdapter(),
        )


def test_enterprise_identity_is_required_and_role_mapped(tmp_path):
    resolver = EnterpriseIdentityResolver(
        proxy_token="p" * 40,
        allowed_roles=frozenset({"BOLT_ANALYST"}),
    )
    client = TestClient(create_app(
        tmp_path / "bolt.db",
        FIXTURE,
        query_adapter=UnusedAdapter(),
        identity_resolver=resolver,
        artifact_path=tmp_path / "artifacts",
    ))
    assert client.get("/health").status_code == 401
    assert client.get("/health", headers=headers(roles="UNAPPROVED")).status_code == 403
    assert client.get("/health", headers=headers()).status_code == 200

    first = client.post("/v1/sessions", headers=headers()).json()["session_id"]
    assert client.get(f"/v1/sessions/{first}/turns", headers=headers("analyst-2")).status_code == 404
    sessions = client.get("/v1/sessions", headers=headers()).json()["sessions"]
    assert sessions[0]["owner_id"] == "analyst-1"


def test_identity_configuration_rejects_short_proxy_secret():
    with pytest.raises(ValueError):
        EnterpriseIdentityResolver(
            proxy_token="short",
            allowed_roles=frozenset({"BOLT_ANALYST"}),
        )
