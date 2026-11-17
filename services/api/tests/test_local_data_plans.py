"""The CSV planner can receive schema, never source rows, and cannot execute data."""
from pathlib import Path
import pytest
from fastapi.testclient import TestClient
from bolt.api import create_app
from bolt.local_data_plans import DataPlanRequest, validate_data_plan
from bolt.model_provider import LocalModelRuntime, ModelSettings

FIXTURE = Path(__file__).resolve().parents[3] / "fixtures/synthetic/revenue.csv"
TOKEN = "d" * 64
SECRET = "private-model-key"
REQUEST = {"question": "Give me a quick snapshot of income", "target": "income",
           "columns": [{"name": "income", "type": "numeric"},
                       {"name": "region", "type": "categorical"},
                       {"name": "day", "type": "date"},
                       {"name": "spend", "type": "numeric"}]}


class FakeGateway:
    last_usage = {"prompt_tokens": 20, "completion_tokens": 10, "cached_tokens": 0}
    last_request = None
    response = {"kind": "overview", "target": "income"}
    def __init__(self, config): pass
    def plan_local(self, question, target, columns):
        FakeGateway.last_request = {"question": question, "target": target, "columns": columns}
        return self.response


def desktop(tmp_path, configured=True, gateway=FakeGateway):
    runtime = LocalModelRuntime(gateway_factory=gateway)
    if configured:
        runtime.configure(ModelSettings(endpoint="https://model.example.test/v1",
            model="model", auth_mode="bearer", token=SECRET))
    return TestClient(create_app(tmp_path / "db", FIXTURE,
        access_token=TOKEN, local_model_runtime=runtime),
        headers={"Authorization": "Bearer " + TOKEN})


def test_schema_only_planner_uses_the_personal_connection(tmp_path):
    client = desktop(tmp_path)
    response = client.post("/_desktop/data/plan", json=REQUEST)
    assert response.status_code == 200
    assert response.json()["plan"] == {"kind": "overview", "target": "income"}
    assert response.json()["usage"]["prompt_tokens"] == 20
    assert FakeGateway.last_request == REQUEST
    assert SECRET not in response.text
    assert client.get("/v1/sessions").json() == {"sessions": []}


def test_no_connection_and_browser_mode_do_not_call_a_model(tmp_path):
    assert desktop(tmp_path, configured=False).post("/_desktop/data/plan", json=REQUEST).status_code == 409
    browser = TestClient(create_app(tmp_path / "browser", FIXTURE))
    assert browser.post("/_desktop/data/plan", json=REQUEST).status_code == 404
    assert desktop(tmp_path).post("/_desktop/data/plan", json=REQUEST,
        headers={"Authorization": ""}).status_code == 401


@pytest.mark.parametrize("extra", [{"rows": [["private-row"]]}, {"preview": ["private-row"]}, {"fileName": "private.csv"}])
def test_row_and_file_fields_are_rejected_without_echoing_them(tmp_path, extra):
    response = desktop(tmp_path).post("/_desktop/data/plan", json={**REQUEST, **extra})
    assert response.status_code == 422
    assert "private-row" not in response.text
    assert "private.csv" not in response.text


@pytest.mark.parametrize("plan", [
    {"kind": "sum", "target": "spend"},
    {"kind": "sum", "target": "income", "sql": "DROP TABLE secret"},
    {"kind": "sum", "target": "income", "filter": "region = private"},
    {"kind": "group", "target": "income", "dimension": "spend", "aggregation": "sum"},
    {"kind": "timeline", "target": "income", "dateColumn": "region", "aggregation": "sum"},
    {"kind": "correlation", "target": "income", "predictor": "income"},
    {"kind": "forecast", "target": "income"},
    {"kind": "group", "target": "income", "dimension": "region", "aggregation": "sum", "limit": True},
])
def test_unsafe_or_incompatible_plans_are_rejected(plan):
    with pytest.raises(ValueError):
        validate_data_plan(plan, DataPlanRequest(**REQUEST))


def test_provider_errors_are_redacted(tmp_path):
    class BrokenGateway(FakeGateway):
        def plan_local(self, *args):
            raise RuntimeError("provider leaked " + SECRET)
    response = desktop(tmp_path, gateway=BrokenGateway).post("/_desktop/data/plan", json=REQUEST)
    assert response.status_code == 502
    assert SECRET not in response.text


def test_invalid_schema_cannot_change_the_approved_numeric_target(tmp_path):
    bad = {**REQUEST, "target": "region"}
    assert desktop(tmp_path).post("/_desktop/data/plan", json=bad).status_code == 422


def test_a_provider_cannot_echo_the_key_in_a_valid_clarification(tmp_path):
    class KeyEchoGateway(FakeGateway):
        response = {"kind": "unsupported", "target": "income", "reason": SECRET}
    response = desktop(tmp_path, gateway=KeyEchoGateway).post("/_desktop/data/plan", json=REQUEST)
    assert response.status_code == 502
    assert SECRET not in response.text


def test_incompatible_model_output_is_rejected_at_the_api_boundary(tmp_path):
    class UnsafeGateway(FakeGateway):
        response = {"kind": "sum", "target": "income", "sql": "SELECT private"}
    response = desktop(tmp_path, gateway=UnsafeGateway).post("/_desktop/data/plan", json=REQUEST)
    assert response.status_code == 502
    assert "SELECT private" not in response.text


def test_actual_gateway_transport_receives_only_schema_and_question():
    import json
    from bolt.model_gateway import GatewayConfig, OpenAICompatibleGateway
    captured = []
    def transport(endpoint, body, headers, timeout):
        captured.append(json.loads(body))
        return json.dumps({"choices": [{"message": {"content": json.dumps({"kind": "sum", "target": "income"})}}]}).encode()
    gateway = OpenAICompatibleGateway(GatewayConfig(
        endpoint="https://model.example.test/v1", model="personal", token=SECRET), transport=transport)
    gateway.plan_local(REQUEST["question"], REQUEST["target"], REQUEST["columns"])
    user_message = json.loads(captured[0]["messages"][1]["content"])
    assert user_message == REQUEST
    assert SECRET not in json.dumps(captured)


def test_unsupported_model_text_is_replaced_by_a_local_clarification(tmp_path):
    class InventedAnswerGateway(FakeGateway):
        response = {"kind": "unsupported", "target": "income", "reason": "Your total income is 999999."}
    result = desktop(tmp_path, gateway=InventedAnswerGateway).post("/_desktop/data/plan", json=REQUEST)
    assert result.status_code == 200
    assert result.json()["plan"]["kind"] == "unsupported"
    assert "999999" not in result.text
