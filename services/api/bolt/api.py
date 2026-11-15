"""Synthetic-only demo API; production identity, access control and Snowflake are not implemented."""
from pathlib import Path
import hmac
import os
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel,Field
from .memory import SessionStore
from .data import load_fixture
from .engine import answer

BASE=Path(__file__).resolve().parents[3]


class ChatRequest(BaseModel):
    session_id: str = Field(min_length=1,max_length=100)
    question: str = Field(min_length=1,max_length=2000)


def create_app(db_path: Path | None=None, fixture_path:Path | None=None, *, access_token: str | None=None) -> FastAPI:
    db_path=Path(db_path) if db_path else BASE / '.local' / 'bolt_sessions.sqlite3'
    fixture_path=Path(fixture_path) if fixture_path else BASE / 'fixtures' / 'synthetic' / 'revenue.csv'
    if access_token is not None and len(access_token) < 32:
        raise ValueError("Desktop API requires a strong random access token")
    store=SessionStore(db_path)
    app=FastAPI(title='BOLT AI — Synthetic Prototype',version='0.1.0')
    if access_token is None:
        # Keep the existing browser-preview workflow working in explicit dev mode.
        app.add_middleware(CORSMiddleware,allow_origins=['http://localhost:5173','http://127.0.0.1:5173','null'],
                           allow_methods=['GET','POST'],allow_headers=['Content-Type'])
    else:
        # Auth applies even to /health and API docs; no CORS for the managed sidecar.
        @app.middleware('http')
        async def require_desktop_token(request: Request, call_next):
            provided = request.headers.get('authorization', '')
            expected = 'Bearer ' + access_token
            if not hmac.compare_digest(provided, expected):
                return JSONResponse(status_code=401, content={'detail':'Unauthorized desktop request'})
            return await call_next(request)

    @app.get('/health')
    def health():
        return {'status':'ok','mode':'synthetic','snowflake_connected':False,'llm_connected':False}

    @app.post('/v1/sessions')
    def new_session():
        return {'session_id':store.create_session()}

    @app.get('/v1/sessions')
    def sessions():
        return {'sessions':store.list_sessions()}

    @app.get('/v1/sessions/{session_id}/turns')
    def turns(session_id:str):
        try:
            return {'turns':store.list_turns(session_id)}
        except KeyError:
            raise HTTPException(404,'Session not found')

    @app.post('/v1/chat')
    def chat(req:ChatRequest):
        if not req.question.strip():
            raise HTTPException(422,'Question cannot be blank')
        if not store.exists(req.session_id):
            raise HTTPException(404,'Session not found')
        memory=store.context_snapshot(req.session_id)
        store.append_turn(req.session_id,'user',req.question)
        with load_fixture(fixture_path) as con:
            result=answer(req.question,memory,con)
        store.append_turn(req.session_id,'assistant',result['answer'],result.pop('memory_update'),payload=result)
        return result

    return app

# The packaged desktop child supplies its own authenticated, explicit app.
# Avoid creating an unintended SQLite file in PyInstaller's extraction directory.
app=create_app() if os.environ.get('BOLT_DESKTOP_CHILD') != '1' else None
