"""Standalone model settings stay behind the authenticated desktop boundary."""
import json
from pathlib import Path
import pytest
from fastapi.testclient import TestClient

from bolt.api import create_app
from bolt.model_provider import LocalModelRuntime, ModelConnectionError, ModelSettings
from bolt.model_gateway import GatewayConfig, OpenAICompatibleGateway

FIXTURE = Path(__file__).resolve().parents[3] / "fixtures/synthetic/revenue.csv"
TOKEN = "d" * 64
SECRET = "test-private-key-do-not-return"
PLAN = {"metric": "revenue", "dimension": "region", "period": "2026",
        "start": "2026-01", "end": "2026-12"}
SETTINGS = {"endpoint": "https://models.example.test/v1", "model": "my-model",
            "auth_mode": "apim", "token": SECRET, "timeout_seconds": 30}


class FakeGateway:
    last_usage = {"prompt_tokens": 8, "completion_tokens": 4, "cached_tokens": 0}
    def __init__(self, config):
        self.config = config
    def plan(self, question, context, catalog):
        return dict(PLAN)


def client_for(tmp_path, runtime=None, authenticated=True):
    return TestClient(create_app(tmp_path / "sessions.db", FIXTURE,
        access_token=TOKEN if authenticated else None,
        local_model_runtime=runtime),
        headers={"Authorization": "Bearer " + TOKEN} if authenticated else {})


def test_connection_is_private_and_session_configuration_is_not_persisted(tmp_path):
    runtime = LocalModelRuntime(gateway_factory=FakeGateway)
    client = client_for(tmp_path, runtime)
    assert client.get("/_desktop/model").json()["configured"] is False
    saved = client.post("/_desktop/model", json=SETTINGS)
    assert saved.status_code == 200
    assert saved.json()["configured"] is True
    assert saved.json()["verified"] is False
    assert SECRET not in saved.text
    assert client.post("/_desktop/model/test", json={}).json()["verified"] is True
    assert SECRET not in client.get("/_desktop/model").text
    assert client.get("/health").json()["llm_connected"] is True
    assert client.get("/v1/preferences").json() == {"preferences": {}}
    assert client_for(tmp_path, LocalModelRuntime()).get("/_desktop/model").json()["configured"] is False


def test_configuration_is_unavailable_to_browser_and_unauthenticated_clients(tmp_path):
    dev = client_for(tmp_path, authenticated=False)
    assert dev.post("/_desktop/model", json=SETTINGS).status_code == 404
    desktop = client_for(tmp_path)
    assert desktop.post("/_desktop/model", json=SETTINGS, headers={"Authorization": ""}).status_code == 401


def test_model_failure_and_validation_never_echo_a_key(tmp_path):
    class BrokenGateway(FakeGateway):
        def plan(self, *_):
            raise RuntimeError("provider body includes " + SECRET)
    runtime = LocalModelRuntime(gateway_factory=BrokenGateway)
    client = client_for(tmp_path, runtime)
    assert client.post("/_desktop/model", json=SETTINGS).status_code == 200
    failed = client.post("/_desktop/model/test", json={})
    assert failed.status_code == 502
    assert SECRET not in failed.text
    invalid = client.post("/_desktop/model", json={**SETTINGS, "timeout_seconds": SECRET})
    assert invalid.status_code == 422
    assert SECRET not in invalid.text
    assert client.get("/_desktop/model").json()["configured"] is True


@pytest.mark.parametrize("endpoint", [
    "http://models.example.test/v1", "https://user:pass@example.test/v1",
    "https://example.test/v1?key=private", "https://example.test/v1#fragment",
    "https:///v1", "https://example.test/\nheader",
])
def test_invalid_endpoints_are_rejected(endpoint):
    runtime = LocalModelRuntime(gateway_factory=FakeGateway)
    with pytest.raises(ValueError):
        runtime.configure(ModelSettings(**{**SETTINGS, "endpoint": endpoint}))


def test_local_http_without_auth_and_disconnect(tmp_path):
    runtime = LocalModelRuntime(gateway_factory=FakeGateway)
    client = client_for(tmp_path, runtime)
    local = {**SETTINGS, "endpoint": "http://127.0.0.1:11434/v1", "auth_mode": "none", "token": ""}
    assert client.post("/_desktop/model", json=local).status_code == 200
    assert client.post("/_desktop/model/disconnect", json={}).json()["configured"] is False
    assert client.get("/health").json()["llm_connected"] is False
    assert client.post("/_desktop/model/test", json={}).status_code == 409


def test_configured_model_is_used_for_a_supported_rephrased_question(tmp_path):
    runtime = LocalModelRuntime(gateway_factory=FakeGateway)
    client = client_for(tmp_path, runtime)
    client.post("/_desktop/model", json=SETTINGS)
    sid = client.post("/v1/sessions").json()["session_id"]
    reply = client.post("/v1/chat", json={"session_id": sid, "question": "Compare the approved segments"})
    assert reply.status_code == 200
    assert reply.json()["cost"]["llm_calls"] == 1
    assert reply.json()["evidence"]["is_synthetic"] is True
    assert reply.json()["data"]["rows"]
    assert SECRET not in client.get(f"/v1/sessions/{sid}/turns").text


def test_apim_header_and_bearer_header_are_mutually_exclusive():
    requests = []
    def transport(endpoint, body, headers, timeout):
        requests.append(headers)
        return json.dumps({"choices": [{"message": {"content": json.dumps(PLAN)}}]}).encode()
    gateway = OpenAICompatibleGateway(GatewayConfig(
        endpoint=SETTINGS["endpoint"], model="my-model", token=SECRET, auth_mode="apim"),
        transport=transport)
    gateway.plan("revenue", {}, [])
    assert requests[0]["Ocp-Apim-Subscription-Key"] == SECRET
    assert "Authorization" not in requests[0]
    assert SECRET not in repr(gateway.config)


def test_no_redirects_can_forward_credentials():
    from bolt.model_gateway import NoModelRedirects
    from urllib.error import HTTPError
    from urllib.request import Request
    with pytest.raises(HTTPError):
        NoModelRedirects().redirect_request(
            Request("https://models.example.test/v1", headers={"Authorization": SECRET}),
            None, 302, "redirect", {}, "https://other.example.test/")


def test_authenticated_service_preserves_an_explicit_gateway(tmp_path):
    gateway = FakeGateway(None)
    client = TestClient(create_app(tmp_path / "injected.db", FIXTURE,
        access_token=TOKEN, model_gateway=gateway),
        headers={"Authorization": "Bearer " + TOKEN})
    sid = client.post("/v1/sessions").json()["session_id"]
    result = client.post("/v1/chat", json={"session_id": sid, "question": "Compare the approved segments"})
    assert result.status_code == 200
    assert result.json()["cost"]["llm_calls"] == 1


def test_no_auth_model_default_token_is_valid():
    settings = ModelSettings(endpoint="http://127.0.0.1:11434/v1", model="local", auth_mode="none")
    runtime = LocalModelRuntime(gateway_factory=FakeGateway)
    assert runtime.configure(settings)["has_key"] is False


def test_failed_retest_clears_verified_status(tmp_path):
    class FlakyGateway(FakeGateway):
        fail = False
        def plan(self, *args):
            if self.fail:
                raise RuntimeError("private provider error " + SECRET)
            return dict(PLAN)
    runtime = LocalModelRuntime(gateway_factory=FlakyGateway)
    client = client_for(tmp_path, runtime)
    client.post("/_desktop/model", json=SETTINGS)
    assert client.get("/health").json()["llm_configured"] is True
    assert client.get("/health").json()["llm_connected"] is False
    assert client.post("/_desktop/model/test", json={}).json()["verified"] is True
    FlakyGateway.fail = True
    failed = client.post("/_desktop/model/test", json={})
    assert failed.status_code == 502
    assert SECRET not in failed.text
    assert client.get("/_desktop/model").json()["verified"] is False
    assert client.get("/health").json()["llm_connected"] is False
    assert client.get("/health").json()["llm_configured"] is True
