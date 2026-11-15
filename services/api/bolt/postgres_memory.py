"""PostgreSQL persistence for the organization-hosted BOLT service."""
from __future__ import annotations

from datetime import datetime, timezone
import json
from urllib.parse import urlparse
import uuid


POSTGRES_SCHEMA = """
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL,
  working_state JSONB NOT NULL DEFAULT '{}'::jsonb,
  owner_id TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_sessions_owner ON sessions(owner_id, created_at DESC);

CREATE TABLE IF NOT EXISTS turns (
  id BIGSERIAL PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK(role IN ('user','assistant')),
  body TEXT NOT NULL,
  payload JSONB,
  created_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_turns_session ON turns(session_id, id);

CREATE TABLE IF NOT EXISTS preferences (
  owner_id TEXT NOT NULL,
  preference_key TEXT NOT NULL,
  preference_value JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY(owner_id, preference_key)
);

CREATE TABLE IF NOT EXISTS audit_events (
  id BIGSERIAL PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  owner_id TEXT NOT NULL,
  event TEXT NOT NULL,
  metadata JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_audit_session ON audit_events(session_id, id);

CREATE TABLE IF NOT EXISTS artifacts (
  artifact_id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  owner_id TEXT NOT NULL,
  filename TEXT NOT NULL,
  size_bytes BIGINT NOT NULL,
  slide_count INTEGER NOT NULL,
  kind TEXT NOT NULL DEFAULT 'presentation',
  mime_type TEXT NOT NULL DEFAULT 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  extension TEXT NOT NULL DEFAULT 'pptx',
  created_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_artifacts_session ON artifacts(session_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ix_artifacts_owner ON artifacts(owner_id, created_at DESC);

CREATE TABLE IF NOT EXISTS collections (
  collection_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_collections_owner ON collections(owner_id, created_at DESC);

CREATE TABLE IF NOT EXISTS collection_items (
  id BIGSERIAL PRIMARY KEY,
  collection_id TEXT NOT NULL REFERENCES collections(collection_id) ON DELETE CASCADE,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  result_ref TEXT NOT NULL,
  title TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_collection_items ON collection_items(collection_id, id);
"""


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _json(value):
    return json.dumps(value, separators=(",", ":"))


def _decoded(value):
    if value is None or isinstance(value, (dict, list, str, int, float, bool)):
        if isinstance(value, str):
            try:
                return json.loads(value)
            except json.JSONDecodeError:
                return value
        return value
    return dict(value)


class PostgresSessionStore:
    """SessionStore-compatible PostgreSQL implementation.

    The connector import is lazy so safe local mode never needs enterprise
    dependencies. A connection factory is injectable for contract tests.
    """

    def __init__(self, database_url: str, *, connect=None):
        parsed = urlparse(database_url)
        if parsed.scheme not in {"postgres", "postgresql"}:
            raise ValueError("Enterprise persistence requires a PostgreSQL URL")
        self.database_url = database_url
        self._connection_factory = connect or self._default_connect
        with self._connect() as con:
            for statement in POSTGRES_SCHEMA.split(";"):
                clean = statement.strip()
                if clean:
                    con.execute(clean + ";")

    @staticmethod
    def _default_connect(database_url: str):
        try:
            import psycopg
            from psycopg.rows import dict_row
        except ImportError as exc:
            raise RuntimeError(
                "PostgreSQL support requires services/api/requirements-enterprise.txt"
            ) from exc
        return psycopg.connect(database_url, row_factory=dict_row)

    def _connect(self):
        return self._connection_factory(self.database_url)

    def create_session(self, owner_id: str = "local"):
        if not owner_id or len(owner_id) > 200:
            raise ValueError("Invalid owner")
        session_id = uuid.uuid4().hex
        with self._connect() as con:
            con.execute(
                "INSERT INTO sessions(id,created_at,owner_id) VALUES (%s,%s,%s)",
                (session_id, _now(), owner_id),
            )
        return session_id

    def exists(self, session_id: str, owner_id: str | None = None):
        with self._connect() as con:
            if owner_id is None:
                row = con.execute(
                    "SELECT 1 AS exists FROM sessions WHERE id=%s",
                    (session_id,),
                ).fetchone()
            else:
                row = con.execute(
                    "SELECT 1 AS exists FROM sessions WHERE id=%s AND owner_id=%s",
                    (session_id, owner_id),
                ).fetchone()
        return row is not None

    def append_turn(self, session_id, role, body, state=None, payload=None):
        if role not in ("assistant", "user"):
            raise ValueError("Invalid role")
        with self._connect() as con:
            if con.execute(
                "SELECT 1 AS exists FROM sessions WHERE id=%s",
                (session_id,),
            ).fetchone() is None:
                raise KeyError("Unknown session")
            con.execute(
                "INSERT INTO turns(session_id,role,body,payload,created_at) "
                "VALUES (%s,%s,%s,%s::jsonb,%s)",
                (
                    session_id,
                    role,
                    body,
                    _json(payload) if payload is not None else None,
                    _now(),
                ),
            )
            if state is not None:
                clean = {
                    key: state[key]
                    for key in ("metric", "dimension", "period", "result_ref")
                    if key in state
                }
                con.execute(
                    "UPDATE sessions SET working_state=%s::jsonb WHERE id=%s",
                    (_json(clean), session_id),
                )

    def context_snapshot(self, session_id):
        with self._connect() as con:
            row = con.execute(
                "SELECT working_state FROM sessions WHERE id=%s",
                (session_id,),
            ).fetchone()
        if row is None:
            raise KeyError("Unknown session")
        return _decoded(row["working_state"])

    def list_turns(self, session_id, owner_id: str | None = None):
        if not self.exists(session_id, owner_id):
            raise KeyError("Unknown session")
        with self._connect() as con:
            rows = con.execute(
                "SELECT role,body,payload,created_at FROM turns "
                "WHERE session_id=%s ORDER BY id",
                (session_id,),
            ).fetchall()
        return [
            {
                "role": row["role"],
                "body": row["body"],
                "payload": _decoded(row["payload"]) if row["payload"] is not None else None,
                "created_at": row["created_at"].isoformat()
                if hasattr(row["created_at"], "isoformat") else str(row["created_at"]),
            }
            for row in rows
        ]

    def list_sessions(self, owner_id: str | None = None):
        with self._connect() as con:
            if owner_id is None:
                rows = con.execute(
                    "SELECT id,created_at,owner_id FROM sessions ORDER BY created_at DESC"
                ).fetchall()
            else:
                rows = con.execute(
                    "SELECT id,created_at,owner_id FROM sessions "
                    "WHERE owner_id=%s ORDER BY created_at DESC",
                    (owner_id,),
                ).fetchall()
        return [
            {
                "session_id": row["id"],
                "created_at": row["created_at"].isoformat()
                if hasattr(row["created_at"], "isoformat") else str(row["created_at"]),
                "owner_id": row["owner_id"],
            }
            for row in rows
        ]

    def set_preference(self, owner_id: str, key: str, value) -> None:
        if not owner_id or not key or len(key) > 100:
            raise ValueError("Invalid preference scope")
        with self._connect() as con:
            con.execute(
                "INSERT INTO preferences(owner_id,preference_key,preference_value,updated_at) "
                "VALUES (%s,%s,%s::jsonb,%s) "
                "ON CONFLICT(owner_id,preference_key) DO UPDATE SET "
                "preference_value=EXCLUDED.preference_value, updated_at=EXCLUDED.updated_at",
                (owner_id, key, _json(value), _now()),
            )

    def list_preferences(self, owner_id: str) -> dict:
        with self._connect() as con:
            rows = con.execute(
                "SELECT preference_key,preference_value FROM preferences WHERE owner_id=%s",
                (owner_id,),
            ).fetchall()
        return {row["preference_key"]: _decoded(row["preference_value"]) for row in rows}

    def append_audit(self, session_id: str, owner_id: str, event: str, metadata: dict) -> None:
        if not self.exists(session_id, owner_id):
            raise KeyError("Unknown session")
        with self._connect() as con:
            con.execute(
                "INSERT INTO audit_events(session_id,owner_id,event,metadata,created_at) "
                "VALUES (%s,%s,%s,%s::jsonb,%s)",
                (session_id, owner_id, event, _json(metadata), _now()),
            )

    def list_audit(self, session_id: str, owner_id: str) -> list[dict]:
        if not self.exists(session_id, owner_id):
            return []
        with self._connect() as con:
            rows = con.execute(
                "SELECT event,metadata,created_at FROM audit_events "
                "WHERE session_id=%s AND owner_id=%s ORDER BY id",
                (session_id, owner_id),
            ).fetchall()
        return [
            {
                "event": row["event"],
                "metadata": _decoded(row["metadata"]),
                "created_at": row["created_at"].isoformat()
                if hasattr(row["created_at"], "isoformat") else str(row["created_at"]),
            }
            for row in rows
        ]

    def register_artifact(
        self,
        session_id: str,
        owner_id: str,
        artifact_id: str,
        filename: str,
        size_bytes: int,
        slide_count: int,
        *,
        kind: str = "presentation",
        mime_type: str = "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        extension: str = "pptx",
    ) -> None:
        if not self.exists(session_id, owner_id):
            raise KeyError("Unknown session")
        with self._connect() as con:
            con.execute(
                "INSERT INTO artifacts(artifact_id,session_id,owner_id,filename,size_bytes,"
                "slide_count,kind,mime_type,extension,created_at) "
                "VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)",
                (
                    artifact_id,
                    session_id,
                    owner_id,
                    filename,
                    int(size_bytes),
                    int(slide_count),
                    kind,
                    mime_type,
                    extension,
                    _now(),
                ),
            )

    def list_artifacts(self, session_id: str, owner_id: str) -> list[dict]:
        if not self.exists(session_id, owner_id):
            return []
        with self._connect() as con:
            rows = con.execute(
                "SELECT artifact_id,filename,size_bytes,slide_count,kind,mime_type,extension,created_at "
                "FROM artifacts WHERE session_id=%s AND owner_id=%s ORDER BY created_at DESC",
                (session_id, owner_id),
            ).fetchall()
        return [
            {
                "artifact_id": row["artifact_id"],
                "filename": row["filename"],
                "size_bytes": row["size_bytes"],
                "slide_count": row["slide_count"],
                "kind": row["kind"],
                "mime_type": row["mime_type"],
                "extension": row["extension"],
                "created_at": row["created_at"].isoformat()
                if hasattr(row["created_at"], "isoformat") else str(row["created_at"]),
            }
            for row in rows
        ]

    def create_collection(self, owner_id: str, name: str) -> str:
        clean = name.strip()
        if not owner_id or not clean or len(clean) > 100:
            raise ValueError("Invalid collection")
        collection_id = uuid.uuid4().hex
        with self._connect() as con:
            con.execute(
                "INSERT INTO collections(collection_id,owner_id,name,created_at) "
                "VALUES (%s,%s,%s,%s)",
                (collection_id, owner_id, clean, _now()),
            )
        return collection_id

    def add_collection_item(
        self,
        owner_id: str,
        collection_id: str,
        session_id: str,
        result_ref: str,
        title: str,
    ) -> None:
        clean_title = title.strip()
        if not clean_title or len(clean_title) > 140 or not result_ref or len(result_ref) > 200:
            raise ValueError("Invalid collection item")
        with self._connect() as con:
            owned_collection = con.execute(
                "SELECT 1 AS exists FROM collections WHERE collection_id=%s AND owner_id=%s",
                (collection_id, owner_id),
            ).fetchone()
            owned_session = con.execute(
                "SELECT 1 AS exists FROM sessions WHERE id=%s AND owner_id=%s",
                (session_id, owner_id),
            ).fetchone()
            if owned_collection is None or owned_session is None:
                raise KeyError("Unknown collection or session")
            con.execute(
                "INSERT INTO collection_items(collection_id,session_id,result_ref,title,created_at) "
                "VALUES (%s,%s,%s,%s,%s)",
                (collection_id, session_id, result_ref, clean_title, _now()),
            )

    def list_collections(self, owner_id: str) -> list[dict]:
        with self._connect() as con:
            collections = con.execute(
                "SELECT collection_id,name,created_at FROM collections "
                "WHERE owner_id=%s ORDER BY created_at DESC",
                (owner_id,),
            ).fetchall()
            result = []
            for collection in collections:
                items = con.execute(
                    "SELECT session_id,result_ref,title,created_at FROM collection_items "
                    "WHERE collection_id=%s ORDER BY id DESC",
                    (collection["collection_id"],),
                ).fetchall()
                result.append({
                    "collection_id": collection["collection_id"],
                    "name": collection["name"],
                    "created_at": collection["created_at"].isoformat()
                    if hasattr(collection["created_at"], "isoformat")
                    else str(collection["created_at"]),
                    "items": [
                        {
                            "session_id": item["session_id"],
                            "result_ref": item["result_ref"],
                            "title": item["title"],
                            "created_at": item["created_at"].isoformat()
                            if hasattr(item["created_at"], "isoformat")
                            else str(item["created_at"]),
                        }
                        for item in items
                    ],
                })
        return result

    def list_owner_artifacts(self, owner_id: str) -> list[dict]:
        with self._connect() as con:
            rows = con.execute(
                "SELECT artifact_id,session_id,filename,size_bytes,slide_count,kind,mime_type,extension,created_at "
                "FROM artifacts WHERE owner_id=%s ORDER BY created_at DESC",
                (owner_id,),
            ).fetchall()
        return [
            {
                "artifact_id": row["artifact_id"],
                "session_id": row["session_id"],
                "filename": row["filename"],
                "size_bytes": row["size_bytes"],
                "slide_count": row["slide_count"],
                "kind": row["kind"],
                "mime_type": row["mime_type"],
                "extension": row["extension"],
                "created_at": row["created_at"].isoformat()
                if hasattr(row["created_at"], "isoformat") else str(row["created_at"]),
            }
            for row in rows
        ]

    def search_memory(self, owner_id: str, query: str, limit: int = 10) -> list[dict]:
        clean = query.strip()
        if not clean or len(clean) > 200 or limit < 1 or limit > 20:
            raise ValueError("Invalid memory search")
        pattern = f"%{clean}%"
        results: list[dict] = []
        with self._connect() as con:
            preferences = con.execute(
                "SELECT preference_key,preference_value FROM preferences "
                "WHERE owner_id=%s AND (preference_key ILIKE %s OR "
                "preference_value::text ILIKE %s) LIMIT %s",
                (owner_id, pattern, pattern, limit),
            ).fetchall()
            for row in preferences:
                results.append({
                    "kind": "preference",
                    "reference": row["preference_key"],
                    "summary": f"{row['preference_key']}: {_decoded(row['preference_value'])}",
                })
            remaining = max(0, limit - len(results))
            if remaining:
                rows = con.execute(
                    "SELECT t.session_id,t.body,t.payload FROM turns t "
                    "JOIN sessions s ON s.id=t.session_id "
                    "WHERE s.owner_id=%s AND t.role='assistant' AND t.body ILIKE %s "
                    "ORDER BY t.id DESC LIMIT %s",
                    (owner_id, pattern, remaining),
                ).fetchall()
                for row in rows:
                    payload = _decoded(row["payload"]) if row["payload"] is not None else {}
                    results.append({
                        "kind": "analysis",
                        "reference": ((payload.get("evidence") or {}).get("query_id")
                                      or row["session_id"]),
                        "session_id": row["session_id"],
                        "summary": row["body"][:240],
                    })
            remaining = max(0, limit - len(results))
            if remaining:
                rows = con.execute(
                    "SELECT collection_id,name FROM collections "
                    "WHERE owner_id=%s AND name ILIKE %s ORDER BY created_at DESC LIMIT %s",
                    (owner_id, pattern, remaining),
                ).fetchall()
                results.extend({
                    "kind": "collection",
                    "reference": row["collection_id"],
                    "summary": row["name"],
                } for row in rows)
            remaining = max(0, limit - len(results))
            if remaining:
                rows = con.execute(
                    "SELECT artifact_id,filename,session_id FROM artifacts "
                    "WHERE owner_id=%s AND filename ILIKE %s ORDER BY created_at DESC LIMIT %s",
                    (owner_id, pattern, remaining),
                ).fetchall()
                results.extend({
                    "kind": "artifact",
                    "reference": row["artifact_id"],
                    "session_id": row["session_id"],
                    "summary": row["filename"],
                } for row in rows)
        return results[:limit]

    def erase_owner(self, owner_id: str) -> dict:
        if not owner_id:
            raise ValueError("Invalid owner")
        with self._connect() as con:
            session_rows = con.execute(
                "SELECT id FROM sessions WHERE owner_id=%s", (owner_id,)
            ).fetchall()
            collection_rows = con.execute(
                "SELECT collection_id FROM collections WHERE owner_id=%s", (owner_id,)
            ).fetchall()
            artifact_rows = con.execute(
                "SELECT artifact_id FROM artifacts WHERE owner_id=%s", (owner_id,)
            ).fetchall()
            preference_row = con.execute(
                "SELECT COUNT(*) AS count FROM preferences WHERE owner_id=%s", (owner_id,)
            ).fetchone()
            con.execute("DELETE FROM collections WHERE owner_id=%s", (owner_id,))
            con.execute("DELETE FROM sessions WHERE owner_id=%s", (owner_id,))
            con.execute("DELETE FROM preferences WHERE owner_id=%s", (owner_id,))
        artifact_ids = [row["artifact_id"] for row in artifact_rows]
        return {
            "sessions": len(session_rows),
            "collections": len(collection_rows),
            "artifacts": len(artifact_ids),
            "preferences": preference_row["count"],
            "artifact_ids": artifact_ids,
        }
