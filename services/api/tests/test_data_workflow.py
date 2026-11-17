"""Real LangGraph pause/resume semantics for schema-only local CSV execution."""
from pathlib import Path
import pytest
from fastapi.testclient import TestClient
from langsmith.run_helpers import get_tracing_context, tracing_context

from bolt.api import create_app
from bolt.data_workflow import LocalDataWorkflow, WorkflowCapacityError, WorkflowConflict, WorkflowNotFound, RunReceipt
from bolt.local_data_plans import DataPlanRequest
from bolt.model_provider import ModelConnectionError

REQUEST = DataPlanRequest(question="A quick snapshot of income", target="income",
    columns=[{"name": "income", "type": "numeric"}, {"name": "region", "type": "categorical"}])


class Planner:
    def __init__(self, plan=None):
        self.calls = 0
        self.tracing = []
        self.plan = plan or {"kind": "sum", "target": "income"}

    def plan_data(self, request):
        self.calls += 1
        self.tracing.append(get_tracing_context().get("enabled"))
        return {"plan": self.plan, "model": "test-model",
                "usage": {"prompt_tokens": 7, "completion_tokens": 3, "cached_tokens": 0}}


def test_real_graph_pauses_for_local_execution_then_resumes_without_replanning():
    planner = Planner()
    workflow = LocalDataWorkflow(planner)
    begun = workflow.start(REQUEST)
    assert begun["workflow"]["engine"] == "langgraph"
    assert begun["workflow"]["status"] == "awaiting_local"
    assert begun["workflow"]["awaiting_local"] is True
    assert begun["plan"] == {"kind": "sum", "target": "income"}
    run_id = begun["workflow"]["run_id"]
    done = workflow.complete(RunReceipt(run_id=run_id, status="completed"))
    assert done["workflow"]["status"] == "completed"
    assert done["workflow"]["awaiting_local"] is False
    assert done["workflow"]["steps"] == [
        "schema_validated", "model_planned", "plan_validated", "awaiting_local",
        "local_completed", "workflow_finished",
    ]
    assert planner.calls == 1
    assert workflow.complete(RunReceipt(run_id=run_id, status="completed")) == done
    assert planner.calls == 1
    with pytest.raises(WorkflowConflict):
        workflow.complete(RunReceipt(run_id=run_id, status="failed"))


@pytest.mark.parametrize("status", ["failed", "cancelled"])
def test_failure_and_cancellation_are_terminal_statuses(status):
    planner = Planner()
    workflow = LocalDataWorkflow(planner)
    run = workflow.start(REQUEST)["workflow"]["run_id"]
    reply = workflow.complete(RunReceipt(run_id=run, status=status))
    assert reply["workflow"]["status"] == status
    assert planner.calls == 1


def test_unsupported_intent_does_not_dispatch_a_calculation():
    planner = Planner({"kind": "unsupported", "target": "income", "reason": "invented 99999"})
    workflow = LocalDataWorkflow(planner)
    reply = workflow.start(REQUEST)
    assert reply["workflow"]["status"] == "unsupported"
    assert reply["workflow"]["awaiting_local"] is False
    assert "99999" not in str(reply)
    with pytest.raises(WorkflowConflict):
        workflow.complete(RunReceipt(run_id=reply["workflow"]["run_id"], status="completed"))


def test_capacity_expiry_and_unknown_ids_are_bounded():
    now = [0.0]
    workflow = LocalDataWorkflow(Planner(), max_runs=1, ttl_seconds=10, clock=lambda: now[0])
    first = workflow.start(REQUEST)["workflow"]["run_id"]
    with pytest.raises(WorkflowCapacityError):
        workflow.start(REQUEST)
    now[0] = 11
    second = workflow.start(REQUEST)["workflow"]["run_id"]
    assert second != first
    with pytest.raises(WorkflowNotFound):
        workflow.complete(RunReceipt(run_id=first, status="completed"))


def test_invalid_model_plan_never_reaches_local_dispatch():
    workflow = LocalDataWorkflow(Planner({"kind": "sum", "target": "another-metric"}))
    with pytest.raises(ModelConnectionError):
        workflow.start(REQUEST)


def test_receipts_reject_result_values_and_rows():
    with pytest.raises(ValueError):
        RunReceipt(run_id="a"*32, status="completed", rows=[["private"]])
    with pytest.raises(ValueError):
        RunReceipt(run_id="a"*32, status="completed", result=999)
    with pytest.raises(ValueError):
        RunReceipt(run_id="../not-a-run", status="completed")


def test_graph_execution_disables_ambient_tracing():
    planner = Planner()
    workflow = LocalDataWorkflow(planner)
    with tracing_context(enabled=True):
        begun = workflow.start(REQUEST)
        workflow.complete(RunReceipt(run_id=begun["workflow"]["run_id"], status="completed"))
    assert planner.tracing == [False]


def test_private_api_requires_desktop_authentication_and_status_only_receipts(tmp_path):
    fixture = Path(__file__).resolve().parents[3] / "fixtures/synthetic/revenue.csv"
    token = "d"*64
    workflow = LocalDataWorkflow(Planner())
    client = TestClient(create_app(tmp_path/"db", fixture, access_token=token,
        local_data_workflow=workflow), headers={"Authorization":"Bearer "+token})
    begun = client.post("/_desktop/data/runs", json=REQUEST.model_dump())
    assert begun.status_code == 200
    run_id = begun.json()["workflow"]["run_id"]
    invalid = client.post("/_desktop/data/complete", json={
        "run_id":run_id,"status":"completed","result":"private-result"})
    assert invalid.status_code == 422
    assert "private-result" not in invalid.text
    done = client.post("/_desktop/data/complete", json={"run_id":run_id,"status":"completed"})
    assert done.status_code == 200
    assert done.json()["workflow"]["status"] == "completed"
    assert client.get("/v1/sessions").json() == {"sessions":[]}
    assert client.post("/_desktop/data/runs", json=REQUEST.model_dump(),
        headers={"Authorization":""}).status_code == 401
    browser = TestClient(create_app(tmp_path/"browser", fixture))
    assert browser.post("/_desktop/data/runs", json=REQUEST.model_dump()).status_code == 404
