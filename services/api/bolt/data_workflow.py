"""Bounded, session-only LangGraph coordination of local CSV calculations."""
from __future__ import annotations
from contextlib import contextmanager
from copy import deepcopy
from dataclasses import dataclass, field
from threading import Lock
from time import monotonic
from typing import Any, Literal
from typing_extensions import TypedDict
from uuid import uuid4

from langgraph.checkpoint.memory import InMemorySaver
from langgraph.graph import END, START, StateGraph
from langgraph.types import Command, interrupt
from langsmith.run_helpers import tracing_context
from pydantic import BaseModel, ConfigDict, Field

from .local_data_plans import DataPlanRequest, validate_data_plan
from .model_provider import ModelConnectionError


class WorkflowConflict(RuntimeError):
    pass


class WorkflowNotFound(RuntimeError):
    pass


class WorkflowCapacityError(RuntimeError):
    pass


class ExecutionStatus(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    status: Literal["completed", "failed", "cancelled"]


class RunReceipt(ExecutionStatus):
    run_id: str = Field(pattern=r"^[a-f0-9]{32}$")


class _State(TypedDict, total=False):
    request: dict
    plan: dict
    model: str
    usage: dict
    steps: list[str]
    status: str


@dataclass
class _Run:
    graph: Any
    created: float
    lock: Any = field(default_factory=Lock)
    response: dict | None = None


class LocalDataWorkflow:
    def __init__(self, planner, *, max_runs=32, ttl_seconds=1800, clock=monotonic):
        if max_runs < 1 or ttl_seconds <= 0:
            raise ValueError("Positive workflow limits are required")
        self._planner = planner
        self._max_runs = max_runs
        self._ttl = ttl_seconds
        self._clock = clock
        self._runs = {}
        self._mutex = Lock()
        builder = StateGraph(_State)
        builder.add_node("schema", self._schema)
        builder.add_node("plan_model", self._plan)
        builder.add_node("validate", self._validate)
        builder.add_node("dispatch", self._dispatch)
        builder.add_node("local", self._local)
        builder.add_node("unsupported", self._unsupported)
        builder.add_node("finish", self._finish)
        builder.add_edge(START, "schema")
        builder.add_edge("schema", "plan_model")
        builder.add_edge("plan_model", "validate")
        builder.add_conditional_edges("validate",
            lambda state: "unsupported" if state["plan"]["kind"] == "unsupported" else "dispatch",
            {"unsupported": "unsupported", "dispatch": "dispatch"})
        builder.add_edge("dispatch", "local")
        builder.add_edge("local", "finish")
        builder.add_edge("unsupported", "finish")
        builder.add_edge("finish", END)
        self._builder = builder

    @staticmethod
    def _schema(state):
        request = DataPlanRequest.model_validate(state["request"]).validate_schema()
        return {"request": request.model_dump(), "steps": ["schema_validated"]}

    def _plan(self, state):
        result = self._planner.plan_data(DataPlanRequest.model_validate(state["request"]))
        return {"plan": result["plan"], "model": result["model"], "usage": result["usage"],
                "steps": state["steps"] + ["model_planned"]}

    @staticmethod
    def _validate(state):
        plan = validate_data_plan(state["plan"], DataPlanRequest.model_validate(state["request"]))
        return {"plan": plan, "steps": state["steps"] + ["plan_validated"]}

    @staticmethod
    def _dispatch(state):
        return {"status": "awaiting_local", "steps": state["steps"] + ["awaiting_local"]}

    @staticmethod
    def _local(state):
        # On resume this node starts again; all model work is in earlier nodes.
        receipt = ExecutionStatus.model_validate(interrupt({"kind": "local_calculation", "plan": state["plan"]}))
        return {"status": receipt.status, "steps": state["steps"] + ["local_" + receipt.status]}

    @staticmethod
    def _unsupported(state):
        return {"status": "unsupported", "steps": state["steps"] + ["unsupported"]}

    @staticmethod
    def _finish(state):
        return {"steps": state["steps"] + ["workflow_finished"]}

    def _prune(self):
        now = self._clock()
        for run_id, run in list(self._runs.items()):
            if not run.lock.locked() and now - run.created >= self._ttl:
                del self._runs[run_id]

    @contextmanager
    def _access(self, run_id):
        with self._mutex:
            self._prune()
            run = self._runs.get(run_id)
            if run is None:
                raise WorkflowNotFound("Workflow expired or is unavailable; start a new question")
            if not run.lock.acquire(blocking=False):
                raise WorkflowConflict("Workflow is busy")
        try:
            yield run
        finally:
            run.lock.release()

    @staticmethod
    def _config(run_id):
        return {"configurable": {"thread_id": run_id}, "recursion_limit": 12, "callbacks": []}

    @staticmethod
    def _view(state, run_id):
        status = state["status"]
        if status not in {"awaiting_local", "unsupported", "completed", "failed", "cancelled"}:
            raise ValueError("Invalid workflow state")
        return {
            "plan": deepcopy(state["plan"]), "model": state["model"], "usage": deepcopy(state["usage"]),
            "workflow": {"engine": "langgraph", "run_id": run_id, "status": status,
                         "steps": list(state["steps"]), "awaiting_local": status == "awaiting_local"},
        }

    def start(self, request: DataPlanRequest):
        request.validate_schema()
        status = getattr(self._planner, 'status', None)
        if callable(status) and not status().get('configured'):
            raise WorkflowConflict('Configure a personal model in Settings first')
        with self._mutex:
            self._prune()
            if len(self._runs) >= self._max_runs:
                terminal = [key for key, run in self._runs.items()
                            if not run.lock.locked() and run.response
                            and not run.response["workflow"]["awaiting_local"]]
                if terminal:
                    del self._runs[terminal[0]]
            if len(self._runs) >= self._max_runs:
                raise WorkflowCapacityError("Too many active workflows; finish a question or wait for expiry")
            run_id = uuid4().hex
            run = _Run(self._builder.compile(checkpointer=InMemorySaver()), self._clock())
            run.lock.acquire()
            self._runs[run_id] = run
        try:
            # CSV metadata must not be sent to an ambient tracing service.
            with tracing_context(enabled=False, parent=False):
                state = run.graph.invoke({"request": request.model_dump(), "steps": [], "status": "planning"},
                                         self._config(run_id))
            if state.get("status") == "awaiting_local" and not state.get("__interrupt__"):
                raise ValueError("Workflow did not pause for local execution")
            run.response = self._view(state, run_id)
            return deepcopy(run.response)
        except Exception:
            with self._mutex:
                self._runs.pop(run_id, None)
            raise ModelConnectionError("The workflow could not prepare a supported calculation. Check the model connection or rephrase the question.") from None
        finally:
            run.lock.release()

    def complete(self, receipt: RunReceipt):
        with self._access(receipt.run_id) as run:
            current = run.response["workflow"]["status"]
            if current == receipt.status:
                return deepcopy(run.response)
            if current != "awaiting_local":
                raise WorkflowConflict("Workflow already has a different terminal status")
            try:
                with tracing_context(enabled=False, parent=False):
                    state = run.graph.invoke(Command(resume={"status": receipt.status}), self._config(receipt.run_id))
                run.response = self._view(state, receipt.run_id)
                return deepcopy(run.response)
            except Exception:
                raise ModelConnectionError("Workflow confirmation failed; the local calculation was not repeated.") from None
