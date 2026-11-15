from pathlib import Path

from fastapi.testclient import TestClient

from bolt.api import create_app
from bolt.memory import SessionStore


FIXTURE = Path(__file__).resolve().parents[3] / "fixtures" / "synthetic" / "revenue.csv"


def test_memory_search_collections_and_erasure_are_owner_scoped(tmp_path):
    store = SessionStore(tmp_path / "state.db")
    first = store.create_session("analyst-1")
    second = store.create_session("analyst-2")
    store.append_turn(
        first,
        "assistant",
        "Revenue increased in the Northeast region.",
        payload={"status": "ok", "evidence": {"query_id": "q-revenue"}},
    )
    store.append_turn(
        second,
        "assistant",
        "Private revenue result for another analyst.",
        payload={"status": "ok", "evidence": {"query_id": "q-private"}},
    )
    store.set_preference("analyst-1", "default_metric", "revenue")
    collection_id = store.create_collection("analyst-1", "Quarterly revenue")
    store.add_collection_item(
        "analyst-1",
        collection_id,
        first,
        "q-revenue",
        "Northeast revenue",
    )

    results = store.search_memory("analyst-1", "revenue", limit=10)
    assert {item["kind"] for item in results} >= {"preference", "analysis", "collection"}
    assert all("private" not in item["summary"].lower() for item in results)
    collections = store.list_collections("analyst-1")
    assert collections[0]["collection_id"] == collection_id
    assert collections[0]["items"][0]["result_ref"] == "q-revenue"
    assert store.list_collections("analyst-2") == []

    erased = store.erase_owner("analyst-1")
    assert erased["sessions"] == 1
    assert erased["collections"] == 1
    assert store.list_sessions("analyst-1") == []
    assert store.list_preferences("analyst-1") == {}
    assert store.list_sessions("analyst-2")[0]["session_id"] == second


def test_memory_preferences_collections_search_and_confirmed_erasure_api(tmp_path):
    artifact_dir = tmp_path / "artifacts"
    app = create_app(tmp_path / "bolt.db", FIXTURE, artifact_path=artifact_dir)
    client = TestClient(app)
    sid = client.post("/v1/sessions").json()["session_id"]
    client.post(
        "/v1/chat",
        json={"session_id": sid, "question": "Show revenue by channel in 2026"},
    )
    artifact = client.post(
        "/v1/presentations",
        json={"session_id": sid, "title": "Revenue memory brief"},
    ).json()
    artifact_file = artifact_dir / f"{artifact['artifact_id']}.pptx"
    assert artifact_file.is_file()
    sources = client.get("/v1/data-sources")
    assert sources.status_code == 200
    assert sources.json()["sources"][0]["mode"] == "synthetic"
    all_artifacts = client.get("/v1/artifacts/all")
    assert all_artifacts.status_code == 200
    assert all_artifacts.json()["artifacts"][0]["artifact_id"] == artifact["artifact_id"]

    saved = client.post(
        "/v1/preferences",
        json={"key": "default_metric", "value": "revenue"},
    )
    assert saved.status_code == 204
    assert client.get("/v1/preferences").json()["preferences"]["default_metric"] == "revenue"

    collection = client.post("/v1/collections", json={"name": "Leadership"}).json()
    item = client.post(
        "/v1/collection-items",
        json={
            "collection_id": collection["collection_id"],
            "session_id": sid,
            "result_ref": "query-reference",
            "title": "Channel revenue",
        },
    )
    assert item.status_code == 201
    assert client.get("/v1/collections").json()["collections"][0]["items"]

    search = client.post("/v1/memory/search", json={"query": "revenue", "limit": 10})
    assert search.status_code == 200
    assert search.json()["results"]

    denied = client.post("/v1/memory/erase", json={"confirmation": "erase"})
    assert denied.status_code == 422
    erased = client.post(
        "/v1/memory/erase",
        json={"confirmation": "ERASE MY BOLT MEMORY"},
    )
    assert erased.status_code == 200
    assert erased.json()["erased"]["sessions"] == 1
    assert not artifact_file.exists()
    assert client.get("/v1/sessions").json()["sessions"] == []


def test_retrieved_memory_is_bounded_into_model_planning_context(tmp_path):
    store = SessionStore(tmp_path / "retrieval.db")
    sid = store.create_session("local")
    store.append_turn(
        sid,
        "assistant",
        "quarterly margin memory from an approved prior analysis",
        payload={"status": "ok", "evidence": {"query_id": "prior-q1"}},
    )

    class Gateway:
        last_usage = {}

        def plan(self, question, context, catalog):
            self.context = context
            return {
                "metric": "revenue",
                "dimension": "channel",
                "period": "2026",
                "start": "2026-01",
                "end": "2026-12",
            }

    gateway = Gateway()
    app = create_app(
        tmp_path / "ignored.db",
        FIXTURE,
        store=store,
        model_gateway=gateway,
    )
    client = TestClient(app)
    response = client.post(
        "/v1/chat",
        json={"session_id": sid, "question": "quarterly margin memory"},
    )
    assert response.status_code == 200
    snippets = gateway.context["memory_snippets"]
    assert len(snippets) <= 3
    assert snippets[0]["reference"] == "prior-q1"
    assert len(str(gateway.context)) <= 2000
