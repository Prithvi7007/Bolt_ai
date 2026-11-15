from bolt.memory import SessionStore


def test_preferences_audit_and_artifacts_are_owner_and_session_scoped(tmp_path):
    store = SessionStore(tmp_path / "state.db")
    first = store.create_session(owner_id="analyst-1")
    second = store.create_session(owner_id="analyst-2")

    store.set_preference("analyst-1", "default_grain", "month")
    assert store.list_preferences("analyst-1") == {"default_grain": "month"}
    assert store.list_preferences("analyst-2") == {}

    store.append_audit(first, "analyst-1", "query.completed", {"query_id": "q1", "rows": 4})
    assert store.list_audit(first, "analyst-1")[0]["event"] == "query.completed"
    assert store.list_audit(first, "analyst-2") == []

    store.register_artifact(first, "analyst-1", "artifact1", "brief.pptx", 123, 3)
    assert store.list_artifacts(first, "analyst-1")[0]["artifact_id"] == "artifact1"
    assert store.list_artifacts(first, "analyst-2") == []
    assert store.list_artifacts(second, "analyst-1") == []
