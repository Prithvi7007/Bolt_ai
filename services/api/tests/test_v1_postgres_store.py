import pytest

from bolt.postgres_memory import POSTGRES_SCHEMA, PostgresSessionStore


class FakeResult:
    def __init__(self, row=None, rows=None):
        self.row = row
        self.rows = rows or []

    def fetchone(self):
        return self.row

    def fetchall(self):
        return self.rows


class FakeConnection:
    def __init__(self):
        self.calls = []
        self.results = []

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False

    def execute(self, sql, params=None):
        self.calls.append((sql, params))
        return self.results.pop(0) if self.results else FakeResult()


def test_postgres_schema_uses_enterprise_types_and_owner_indexes():
    assert "JSONB" in POSTGRES_SCHEMA
    assert "TIMESTAMPTZ" in POSTGRES_SCHEMA
    assert "BIGSERIAL" in POSTGRES_SCHEMA
    assert "ix_sessions_owner" in POSTGRES_SCHEMA
    assert "ix_artifacts_owner" in POSTGRES_SCHEMA
    assert "CREATE TABLE IF NOT EXISTS collections" in POSTGRES_SCHEMA
    assert "CREATE TABLE IF NOT EXISTS collection_items" in POSTGRES_SCHEMA


def test_postgres_store_rejects_non_postgres_urls():
    with pytest.raises(ValueError, match="PostgreSQL"):
        PostgresSessionStore("sqlite:///tmp/bolt.db", connect=lambda _: FakeConnection())


def test_postgres_store_initializes_schema_and_parameterizes_identity_queries():
    connections = []

    def connect(url):
        assert url == "postgresql://bolt:secret@db/bolt"
        connection = FakeConnection()
        connections.append(connection)
        return connection

    store = PostgresSessionStore(
        "postgresql://bolt:secret@db/bolt",
        connect=connect,
    )
    schema_calls = connections[0].calls
    assert len(schema_calls) > 5
    assert all(params is None for _, params in schema_calls)
    assert all(sql.strip().endswith(";") for sql, _ in schema_calls)

    session_id = store.create_session("analyst@example.com")
    insert_sql, insert_params = connections[1].calls[0]
    assert "%s" in insert_sql
    assert insert_params[0] == session_id
    assert insert_params[2] == "analyst@example.com"
    assert "analyst@example.com" not in insert_sql

    exists_connection = FakeConnection()
    exists_connection.results = [FakeResult(row={"exists": 1})]
    connections.append(exists_connection)
    store._connect = lambda: exists_connection
    assert store.exists(session_id, "analyst@example.com") is True
    exists_sql, exists_params = exists_connection.calls[0]
    assert "owner_id=%s" in exists_sql
    assert exists_params == (session_id, "analyst@example.com")
