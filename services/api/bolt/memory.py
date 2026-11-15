"""Conversation ledger, bounded working state, scoped preferences, audit and artifact indexes."""
from pathlib import Path
from datetime import datetime, timezone
import json
import sqlite3
import uuid


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


class SessionStore:
    def __init__(self, path: Path):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with self._connect() as con:
            con.executescript("""
            CREATE TABLE IF NOT EXISTS sessions (
              id TEXT PRIMARY KEY, created_at TEXT NOT NULL,
              working_state TEXT NOT NULL DEFAULT '{}',
              owner_id TEXT NOT NULL DEFAULT 'local'
            );
            CREATE TABLE IF NOT EXISTS turns (
              id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT NOT NULL,
              role TEXT NOT NULL CHECK(role IN ('user','assistant')),
              body TEXT NOT NULL, payload TEXT, created_at TEXT NOT NULL,
              FOREIGN KEY(session_id) REFERENCES sessions(id)
            );
            CREATE INDEX IF NOT EXISTS ix_turns_session ON turns(session_id,id);
            CREATE TABLE IF NOT EXISTS preferences (
              owner_id TEXT NOT NULL, preference_key TEXT NOT NULL, preference_value TEXT NOT NULL,
              updated_at TEXT NOT NULL, PRIMARY KEY(owner_id, preference_key)
            );
            CREATE TABLE IF NOT EXISTS audit_events (
              id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT NOT NULL, owner_id TEXT NOT NULL,
              event TEXT NOT NULL, metadata TEXT NOT NULL, created_at TEXT NOT NULL,
              FOREIGN KEY(session_id) REFERENCES sessions(id)
            );
            CREATE INDEX IF NOT EXISTS ix_audit_session ON audit_events(session_id,id);
            CREATE TABLE IF NOT EXISTS artifacts (
              artifact_id TEXT PRIMARY KEY, session_id TEXT NOT NULL, owner_id TEXT NOT NULL,
              filename TEXT NOT NULL, size_bytes INTEGER NOT NULL, slide_count INTEGER NOT NULL,
              kind TEXT NOT NULL DEFAULT 'presentation',
              mime_type TEXT NOT NULL DEFAULT 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
              extension TEXT NOT NULL DEFAULT 'pptx',
              created_at TEXT NOT NULL, FOREIGN KEY(session_id) REFERENCES sessions(id)
            );
            CREATE INDEX IF NOT EXISTS ix_artifacts_session ON artifacts(session_id,created_at);
            CREATE TABLE IF NOT EXISTS collections (
              collection_id TEXT PRIMARY KEY, owner_id TEXT NOT NULL,
              name TEXT NOT NULL, created_at TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS ix_collections_owner ON collections(owner_id,created_at);
            CREATE TABLE IF NOT EXISTS collection_items (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              collection_id TEXT NOT NULL, session_id TEXT NOT NULL,
              result_ref TEXT NOT NULL, title TEXT NOT NULL, created_at TEXT NOT NULL,
              FOREIGN KEY(collection_id) REFERENCES collections(collection_id),
              FOREIGN KEY(session_id) REFERENCES sessions(id)
            );
            CREATE INDEX IF NOT EXISTS ix_collection_items ON collection_items(collection_id,id);
            """)
            columns = {row["name"] for row in con.execute("PRAGMA table_info(sessions)")}
            if "owner_id" not in columns:
                con.execute("ALTER TABLE sessions ADD COLUMN owner_id TEXT NOT NULL DEFAULT 'local'")
            artifact_columns = {row["name"] for row in con.execute("PRAGMA table_info(artifacts)")}
            if "kind" not in artifact_columns:
                con.execute("ALTER TABLE artifacts ADD COLUMN kind TEXT NOT NULL DEFAULT 'presentation'")
            if "mime_type" not in artifact_columns:
                con.execute(
                    "ALTER TABLE artifacts ADD COLUMN mime_type TEXT NOT NULL DEFAULT "
                    "'application/vnd.openxmlformats-officedocument.presentationml.presentation'"
                )
            if "extension" not in artifact_columns:
                con.execute("ALTER TABLE artifacts ADD COLUMN extension TEXT NOT NULL DEFAULT 'pptx'")

    def _connect(self):
        con = sqlite3.connect(self.path, timeout=10)
        con.row_factory = sqlite3.Row
        con.execute("PRAGMA foreign_keys=ON")
        return con

    def create_session(self, owner_id: str = "local"):
        if not owner_id or len(owner_id) > 200:
            raise ValueError("Invalid owner")
        session_id = uuid.uuid4().hex
        with self._connect() as con:
            con.execute(
                "INSERT INTO sessions(id,created_at,owner_id) VALUES (?,?,?)",
                (session_id, _now(), owner_id),
            )
        return session_id

    def exists(self, session_id: str, owner_id: str | None = None):
        with self._connect() as con:
            if owner_id is None:
                row = con.execute("SELECT 1 FROM sessions WHERE id=?", (session_id,)).fetchone()
            else:
                row = con.execute(
                    "SELECT 1 FROM sessions WHERE id=? AND owner_id=?",
                    (session_id, owner_id),
                ).fetchone()
            return row is not None

    def append_turn(self, session_id, role, body, state=None, payload=None):
        if role not in ("assistant", "user"):
            raise ValueError("Invalid role")
        with self._connect() as con:
            if con.execute("SELECT 1 FROM sessions WHERE id=?", (session_id,)).fetchone() is None:
                raise KeyError("Unknown session")
            con.execute(
                "INSERT INTO turns(session_id,role,body,payload,created_at) VALUES (?,?,?,?,?)",
                (
                    session_id,
                    role,
                    body,
                    json.dumps(payload) if payload is not None else None,
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
                    "UPDATE sessions SET working_state=? WHERE id=?",
                    (json.dumps(clean), session_id),
                )

    def context_snapshot(self, session_id):
        with self._connect() as con:
            row = con.execute(
                "SELECT working_state FROM sessions WHERE id=?",
                (session_id,),
            ).fetchone()
            if row is None:
                raise KeyError("Unknown session")
            return json.loads(row["working_state"])

    def list_turns(self, session_id, owner_id: str | None = None):
        if not self.exists(session_id, owner_id):
            raise KeyError("Unknown session")
        with self._connect() as con:
            return [
                {
                    "role": row["role"],
                    "body": row["body"],
                    "payload": json.loads(row["payload"]) if row["payload"] else None,
                    "created_at": row["created_at"],
                }
                for row in con.execute(
                    "SELECT role,body,payload,created_at FROM turns "
                    "WHERE session_id=? ORDER BY id",
                    (session_id,),
                )
            ]

    def list_sessions(self, owner_id: str | None = None):
        with self._connect() as con:
            if owner_id is None:
                rows = con.execute(
                    "SELECT id,created_at,owner_id FROM sessions ORDER BY created_at DESC"
                )
            else:
                rows = con.execute(
                    "SELECT id,created_at,owner_id FROM sessions "
                    "WHERE owner_id=? ORDER BY created_at DESC",
                    (owner_id,),
                )
            return [
                {
                    "session_id": row["id"],
                    "created_at": row["created_at"],
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
                "VALUES (?,?,?,?) ON CONFLICT(owner_id,preference_key) DO UPDATE SET "
                "preference_value=excluded.preference_value, updated_at=excluded.updated_at",
                (owner_id, key, json.dumps(value), _now()),
            )

    def list_preferences(self, owner_id: str) -> dict:
        with self._connect() as con:
            return {
                row["preference_key"]: json.loads(row["preference_value"])
                for row in con.execute(
                    "SELECT preference_key,preference_value FROM preferences WHERE owner_id=?",
                    (owner_id,),
                )
            }

    def append_audit(self, session_id: str, owner_id: str, event: str, metadata: dict) -> None:
        if not self.exists(session_id, owner_id):
            raise KeyError("Unknown session")
        with self._connect() as con:
            con.execute(
                "INSERT INTO audit_events(session_id,owner_id,event,metadata,created_at) "
                "VALUES (?,?,?,?,?)",
                (session_id, owner_id, event, json.dumps(metadata), _now()),
            )

    def list_audit(self, session_id: str, owner_id: str) -> list[dict]:
        if not self.exists(session_id, owner_id):
            return []
        with self._connect() as con:
            return [
                {
                    "event": row["event"],
                    "metadata": json.loads(row["metadata"]),
                    "created_at": row["created_at"],
                }
                for row in con.execute(
                    "SELECT event,metadata,created_at FROM audit_events "
                    "WHERE session_id=? AND owner_id=? ORDER BY id",
                    (session_id, owner_id),
                )
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
                "INSERT INTO artifacts(artifact_id,session_id,owner_id,filename,size_bytes,slide_count,"
                "kind,mime_type,extension,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
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
            return [
                {
                    "artifact_id": row["artifact_id"],
                    "filename": row["filename"],
                    "size_bytes": row["size_bytes"],
                    "slide_count": row["slide_count"],
                    "kind": row["kind"],
                    "mime_type": row["mime_type"],
                    "extension": row["extension"],
                    "created_at": row["created_at"],
                }
                for row in con.execute(
                    "SELECT artifact_id,filename,size_bytes,slide_count,kind,mime_type,extension,created_at "
                    "FROM artifacts WHERE session_id=? AND owner_id=? ORDER BY created_at DESC",
                    (session_id, owner_id),
                )
            ]

    def create_collection(self, owner_id: str, name: str) -> str:
        clean = name.strip()
        if not owner_id or not clean or len(clean) > 100:
            raise ValueError("Invalid collection")
        collection_id = uuid.uuid4().hex
        with self._connect() as con:
            con.execute(
                "INSERT INTO collections(collection_id,owner_id,name,created_at) VALUES (?,?,?,?)",
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
                "SELECT 1 FROM collections WHERE collection_id=? AND owner_id=?",
                (collection_id, owner_id),
            ).fetchone()
            owned_session = con.execute(
                "SELECT 1 FROM sessions WHERE id=? AND owner_id=?",
                (session_id, owner_id),
            ).fetchone()
            if owned_collection is None or owned_session is None:
                raise KeyError("Unknown collection or session")
            con.execute(
                "INSERT INTO collection_items(collection_id,session_id,result_ref,title,created_at) "
                "VALUES (?,?,?,?,?)",
                (collection_id, session_id, result_ref, clean_title, _now()),
            )

    def list_collections(self, owner_id: str) -> list[dict]:
        with self._connect() as con:
            collections = list(con.execute(
                "SELECT collection_id,name,created_at FROM collections "
                "WHERE owner_id=? ORDER BY created_at DESC",
                (owner_id,),
            ))
            result = []
            for collection in collections:
                items = [
                    {
                        "session_id": row["session_id"],
                        "result_ref": row["result_ref"],
                        "title": row["title"],
                        "created_at": row["created_at"],
                    }
                    for row in con.execute(
                        "SELECT session_id,result_ref,title,created_at FROM collection_items "
                        "WHERE collection_id=? ORDER BY id DESC",
                        (collection["collection_id"],),
                    )
                ]
                result.append({
                    "collection_id": collection["collection_id"],
                    "name": collection["name"],
                    "created_at": collection["created_at"],
                    "items": items,
                })
            return result

    def list_owner_artifacts(self, owner_id: str) -> list[dict]:
        with self._connect() as con:
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
                    "created_at": row["created_at"],
                }
                for row in con.execute(
                    "SELECT artifact_id,session_id,filename,size_bytes,slide_count,kind,mime_type,extension,created_at "
                    "FROM artifacts WHERE owner_id=? ORDER BY created_at DESC",
                    (owner_id,),
                )
            ]

    def search_memory(self, owner_id: str, query: str, limit: int = 10) -> list[dict]:
        clean = query.strip()
        if not clean or len(clean) > 200 or limit < 1 or limit > 20:
            raise ValueError("Invalid memory search")
        pattern = f"%{clean}%"
        results: list[dict] = []
        with self._connect() as con:
            for row in con.execute(
                "SELECT preference_key,preference_value FROM preferences "
                "WHERE owner_id=? AND (preference_key LIKE ? OR preference_value LIKE ?) LIMIT ?",
                (owner_id, pattern, pattern, limit),
            ):
                results.append({
                    "kind": "preference",
                    "reference": row["preference_key"],
                    "summary": f"{row['preference_key']}: {json.loads(row['preference_value'])}",
                })
            remaining = max(0, limit - len(results))
            if remaining:
                for row in con.execute(
                    "SELECT t.session_id,t.body,t.payload FROM turns t "
                    "JOIN sessions s ON s.id=t.session_id "
                    "WHERE s.owner_id=? AND t.role='assistant' AND t.body LIKE ? "
                    "ORDER BY t.id DESC LIMIT ?",
                    (owner_id, pattern, remaining),
                ):
                    payload = json.loads(row["payload"]) if row["payload"] else {}
                    reference = ((payload.get("evidence") or {}).get("query_id")
                                 or row["session_id"])
                    results.append({
                        "kind": "analysis",
                        "reference": reference,
                        "session_id": row["session_id"],
                        "summary": row["body"][:240],
                    })
            remaining = max(0, limit - len(results))
            if remaining:
                for row in con.execute(
                    "SELECT collection_id,name FROM collections "
                    "WHERE owner_id=? AND name LIKE ? ORDER BY created_at DESC LIMIT ?",
                    (owner_id, pattern, remaining),
                ):
                    results.append({
                        "kind": "collection",
                        "reference": row["collection_id"],
                        "summary": row["name"],
                    })
            remaining = max(0, limit - len(results))
            if remaining:
                for row in con.execute(
                    "SELECT artifact_id,filename,session_id FROM artifacts "
                    "WHERE owner_id=? AND filename LIKE ? ORDER BY created_at DESC LIMIT ?",
                    (owner_id, pattern, remaining),
                ):
                    results.append({
                        "kind": "artifact",
                        "reference": row["artifact_id"],
                        "session_id": row["session_id"],
                        "summary": row["filename"],
                    })
        return results[:limit]

    def erase_owner(self, owner_id: str) -> dict:
        if not owner_id:
            raise ValueError("Invalid owner")
        with self._connect() as con:
            session_rows = list(con.execute(
                "SELECT id FROM sessions WHERE owner_id=?", (owner_id,)
            ))
            session_ids = [row["id"] for row in session_rows]
            collection_rows = list(con.execute(
                "SELECT collection_id FROM collections WHERE owner_id=?", (owner_id,)
            ))
            collection_ids = [row["collection_id"] for row in collection_rows]
            artifact_rows = list(con.execute(
                "SELECT artifact_id FROM artifacts WHERE owner_id=?", (owner_id,)
            ))
            artifact_ids = [row["artifact_id"] for row in artifact_rows]
            for collection_id in collection_ids:
                con.execute(
                    "DELETE FROM collection_items WHERE collection_id=?", (collection_id,)
                )
            con.execute("DELETE FROM collections WHERE owner_id=?", (owner_id,))
            for session_id in session_ids:
                con.execute("DELETE FROM artifacts WHERE session_id=?", (session_id,))
                con.execute("DELETE FROM audit_events WHERE session_id=?", (session_id,))
                con.execute("DELETE FROM turns WHERE session_id=?", (session_id,))
            con.execute("DELETE FROM sessions WHERE owner_id=?", (owner_id,))
            preference_count = con.execute(
                "SELECT COUNT(*) AS count FROM preferences WHERE owner_id=?", (owner_id,)
            ).fetchone()["count"]
            con.execute("DELETE FROM preferences WHERE owner_id=?", (owner_id,))
        return {
            "sessions": len(session_ids),
            "collections": len(collection_ids),
            "artifacts": len(artifact_ids),
            "preferences": preference_count,
            "artifact_ids": artifact_ids,
        }
