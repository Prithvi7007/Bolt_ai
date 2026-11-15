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
              created_at TEXT NOT NULL, FOREIGN KEY(session_id) REFERENCES sessions(id)
            );
            CREATE INDEX IF NOT EXISTS ix_artifacts_session ON artifacts(session_id,created_at);
            """)
            columns = {row["name"] for row in con.execute("PRAGMA table_info(sessions)")}
            if "owner_id" not in columns:
                con.execute("ALTER TABLE sessions ADD COLUMN owner_id TEXT NOT NULL DEFAULT 'local'")

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
    ) -> None:
        if not self.exists(session_id, owner_id):
            raise KeyError("Unknown session")
        with self._connect() as con:
            con.execute(
                "INSERT INTO artifacts(artifact_id,session_id,owner_id,filename,size_bytes,slide_count,created_at) "
                "VALUES (?,?,?,?,?,?,?)",
                (
                    artifact_id,
                    session_id,
                    owner_id,
                    filename,
                    int(size_bytes),
                    int(slide_count),
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
                    "created_at": row["created_at"],
                }
                for row in con.execute(
                    "SELECT artifact_id,filename,size_bytes,slide_count,created_at "
                    "FROM artifacts WHERE session_id=? AND owner_id=? ORDER BY created_at DESC",
                    (session_id, owner_id),
                )
            ]
