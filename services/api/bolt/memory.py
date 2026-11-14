"""A complete display ledger and separate bounded working-memory state."""
from pathlib import Path
from datetime import datetime,timezone
import json
import sqlite3
import uuid


class SessionStore:
    def __init__(self, path: Path):
        self.path=Path(path)
        self.path.parent.mkdir(parents=True,exist_ok=True)
        with self._connect() as con:
            con.executescript('''
            CREATE TABLE IF NOT EXISTS sessions (
              id TEXT PRIMARY KEY, created_at TEXT NOT NULL, working_state TEXT NOT NULL DEFAULT '{}'
            );
            CREATE TABLE IF NOT EXISTS turns (
              id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT NOT NULL,
              role TEXT NOT NULL CHECK(role IN ('user','assistant')),
              body TEXT NOT NULL, payload TEXT, created_at TEXT NOT NULL,
              FOREIGN KEY(session_id) REFERENCES sessions(id)
            );
            CREATE INDEX IF NOT EXISTS ix_turns_session ON turns(session_id,id);
            ''')

    def _connect(self):
        con=sqlite3.connect(self.path,timeout=10)
        con.row_factory=sqlite3.Row
        con.execute('PRAGMA foreign_keys=ON')
        return con

    def create_session(self):
        sid=uuid.uuid4().hex
        with self._connect() as con:
            con.execute('INSERT INTO sessions(id,created_at) VALUES (?,?)',(sid,datetime.now(timezone.utc).isoformat()))
        return sid

    def exists(self,sid):
        with self._connect() as con:
            return con.execute('SELECT 1 FROM sessions WHERE id=?',(sid,)).fetchone() is not None

    def append_turn(self,sid,role,body,state=None,payload=None):
        if role not in ('assistant','user'):
            raise ValueError('Invalid role')
        with self._connect() as con:
            if con.execute('SELECT 1 FROM sessions WHERE id=?',(sid,)).fetchone() is None:
                raise KeyError('Unknown session')
            con.execute('INSERT INTO turns(session_id,role,body,payload,created_at) VALUES (?,?,?,?,?)',
                        (sid,role,body,json.dumps(payload) if payload is not None else None,datetime.now(timezone.utc).isoformat()))
            if state is not None:
                clean={k:state[k] for k in ('metric','dimension','period','result_ref') if k in state}
                con.execute('UPDATE sessions SET working_state=? WHERE id=?',(json.dumps(clean),sid))

    def context_snapshot(self,sid):
        with self._connect() as con:
            r=con.execute('SELECT working_state FROM sessions WHERE id=?',(sid,)).fetchone()
            if r is None:
                raise KeyError('Unknown session')
            return json.loads(r['working_state'])

    def list_turns(self,sid):
        if not self.exists(sid):
            raise KeyError('Unknown session')
        with self._connect() as con:
            return [{'role':r['role'],'body':r['body'],'payload':json.loads(r['payload']) if r['payload'] else None,
                    'created_at':r['created_at']} for r in con.execute('SELECT role,body,payload,created_at FROM turns WHERE session_id=? ORDER BY id',(sid,))]

    def list_sessions(self):
        with self._connect() as con:
            return [{'session_id':r['id'],'created_at':r['created_at']} for r in con.execute('SELECT id,created_at FROM sessions ORDER BY created_at DESC')]
