"""BOLT API with safe synthetic defaults and optional governed enterprise adapters."""
from pathlib import Path
import base64
import hmac
import os
import re
from typing import Any, Literal

from fastapi import FastAPI, HTTPException, Request, Response
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from .artifacts import ChartBuilder, PPTX_MIME, PresentationBuilder, SVG_MIME
from .memory import SessionStore
from .data import load_fixture
from .engine import answer
from .semantic_catalog import catalog_payload


BASE = Path(__file__).resolve().parents[3]
_ARTIFACT_ID = re.compile(r"^[a-f0-9]{32}$")


class ChatRequest(BaseModel):
    session_id: str = Field(min_length=1, max_length=100)
    question: str = Field(min_length=1, max_length=2000)


class PresentationRequest(BaseModel):
    session_id: str = Field(min_length=32, max_length=32)
    title: str = Field(min_length=1, max_length=140)


class ChartRequest(BaseModel):
    session_id: str = Field(min_length=32, max_length=32)
    query_id: str = Field(min_length=1, max_length=200)


class PreferenceRequest(BaseModel):
    key: str = Field(min_length=1, max_length=100)
    value: Any


class MemorySearchRequest(BaseModel):
    query: str = Field(min_length=1, max_length=200)
    limit: int = Field(default=10, ge=1, le=20)


class MemoryEraseRequest(BaseModel):
    confirmation: Literal["ERASE MY BOLT MEMORY"]


class CollectionRequest(BaseModel):
    name: str = Field(min_length=1, max_length=100)


class CollectionItemRequest(BaseModel):
    collection_id: str = Field(min_length=32, max_length=32)
    session_id: str = Field(min_length=32, max_length=32)
    result_ref: str = Field(min_length=1, max_length=200)
    title: str = Field(min_length=1, max_length=140)


def create_app(
    db_path: Path | None = None,
    fixture_path: Path | None = None,
    *,
    access_token: str | None = None,
    artifact_path: Path | None = None,
    query_adapter=None,
    model_gateway=None,
    identity_resolver=None,
    owner_id: str = "local",
    store=None,
) -> FastAPI:
    db_path = Path(db_path) if db_path else BASE / ".local" / "bolt_sessions.sqlite3"
    fixture_path = (
        Path(fixture_path)
        if fixture_path
        else BASE / "fixtures" / "synthetic" / "revenue.csv"
    )
    artifact_path = (
        Path(artifact_path)
        if artifact_path
        else db_path.parent / "bolt_artifacts"
    )
    if access_token is not None and len(access_token) < 32:
        raise ValueError("Desktop API requires a strong random access token")
    if not owner_id or len(owner_id) > 200:
        raise ValueError("A bounded owner identity is required")
    enterprise = query_adapter is not None
    if enterprise and identity_resolver is None:
        raise ValueError("Enterprise query mode requires a fail-closed identity resolver")

    store = store or SessionStore(db_path)
    presentations = PresentationBuilder(artifact_path)
    charts = ChartBuilder(artifact_path)
    app = FastAPI(title="BOLT AI — Decision Intelligence", version="1.0.0")

    if enterprise:
        @app.middleware("http")
        async def require_enterprise_identity(request: Request, call_next):
            try:
                request.state.identity = identity_resolver.resolve(request)
            except HTTPException as exc:
                return JSONResponse(status_code=exc.status_code, content={"detail": exc.detail})
            return await call_next(request)
    elif access_token is None:
        app.add_middleware(
            CORSMiddleware,
            allow_origins=[
                "http://localhost:5173",
                "http://127.0.0.1:5173",
                "null",
            ],
            allow_methods=["GET", "POST"],
            allow_headers=["Content-Type"],
        )
    else:
        @app.middleware("http")
        async def require_desktop_token(request: Request, call_next):
            provided = request.headers.get("authorization", "")
            expected = "Bearer " + access_token
            if not hmac.compare_digest(provided, expected):
                return JSONResponse(
                    status_code=401,
                    content={"detail": "Unauthorized desktop request"},
                )
            return await call_next(request)

    def actor(request: Request) -> str:
        identity = getattr(request.state, "identity", None)
        return identity.subject if identity is not None else owner_id

    @app.get("/health")
    def health(request: Request):
        return {
            "status": "ok",
            "mode": "enterprise" if enterprise else "synthetic",
            "version": "1.0.0",
            "snowflake_connected": enterprise,
            "llm_connected": model_gateway is not None,
            "capabilities": {
                "governed_queries": True,
                "bounded_investigations": True,
                "presentations": True,
                "persistent_memory": True,
            },
        }

    @app.get("/v1/catalog")
    def catalog(request: Request):
        return {"metrics": catalog_payload()}

    @app.get("/v1/data-sources")
    def data_sources(request: Request):
        if enterprise:
            source_name = getattr(getattr(query_adapter, "config", None), "source_object", "approved semantic source")
            sources = [{
                "source_id": "governed-snowflake",
                "name": source_name,
                "mode": "enterprise",
                "connected": True,
                "read_only": True,
            }]
        else:
            sources = [{
                "source_id": "synthetic-revenue",
                "name": "Synthetic revenue fixture",
                "mode": "synthetic",
                "connected": True,
                "read_only": True,
            }]
        return {"sources": sources}

    @app.post("/v1/sessions")
    def new_session(request: Request):
        return {"session_id": store.create_session(owner_id=actor(request))}

    @app.get("/v1/sessions")
    def sessions(request: Request):
        return {"sessions": store.list_sessions(owner_id=actor(request))}

    @app.get("/v1/sessions/{session_id}/turns")
    def turns(session_id: str, request: Request):
        try:
            return {"turns": store.list_turns(session_id, owner_id=actor(request))}
        except KeyError:
            raise HTTPException(404, "Session not found")

    @app.get("/v1/preferences")
    def preferences(request: Request):
        return {"preferences": store.list_preferences(actor(request))}

    @app.post("/v1/preferences", status_code=204)
    def save_preference(req: PreferenceRequest, request: Request):
        store.set_preference(actor(request), req.key, req.value)
        return Response(status_code=204)

    @app.post("/v1/memory/search")
    def search_memory(req: MemorySearchRequest, request: Request):
        return {
            "results": store.search_memory(
                actor(request),
                req.query,
                limit=req.limit,
            )
        }

    @app.post("/v1/memory/erase")
    def erase_memory(req: MemoryEraseRequest, request: Request):
        actor_id = actor(request)
        owned_artifacts = store.list_owner_artifacts(actor_id)
        erased = store.erase_owner(actor_id)
        erased.pop("artifact_ids", None)
        for artifact in owned_artifacts:
            extension = artifact.get("extension", "pptx")
            (artifact_path / f"{artifact['artifact_id']}.{extension}").unlink(missing_ok=True)
        return {"erased": erased}

    @app.post("/v1/collections", status_code=201)
    def create_collection(req: CollectionRequest, request: Request):
        collection_id = store.create_collection(actor(request), req.name)
        return {"collection_id": collection_id, "name": req.name.strip()}

    @app.get("/v1/collections")
    def collections(request: Request):
        return {"collections": store.list_collections(actor(request))}

    @app.post("/v1/collection-items", status_code=201)
    def add_collection_item(req: CollectionItemRequest, request: Request):
        try:
            store.add_collection_item(
                actor(request),
                req.collection_id,
                req.session_id,
                req.result_ref,
                req.title,
            )
        except KeyError:
            raise HTTPException(404, "Collection or session not found")
        return {"status": "saved"}

    @app.post("/v1/chat")
    def chat(req: ChatRequest, request: Request):
        actor_id = actor(request)
        if not req.question.strip():
            raise HTTPException(422, "Question cannot be blank")
        if not store.exists(req.session_id, actor_id):
            raise HTTPException(404, "Session not found")
        memory = store.context_snapshot(req.session_id)
        retrieved = store.search_memory(actor_id, req.question, limit=3)
        memory["memory_snippets"] = [
            {
                "kind": item["kind"],
                "reference": item["reference"],
                "summary": item["summary"][:160],
            }
            for item in retrieved
        ]
        store.append_turn(req.session_id, "user", req.question)
        if query_adapter is None:
            with load_fixture(fixture_path) as connection:
                result = answer(
                    req.question,
                    memory,
                    connection,
                    gateway=model_gateway,
                    actor_id=actor_id,
                )
        else:
            result = answer(
                req.question,
                memory,
                adapter=query_adapter,
                gateway=model_gateway,
                actor_id=actor_id,
            )
        memory_update = result.pop("memory_update")
        store.append_turn(
            req.session_id,
            "assistant",
            result["answer"],
            memory_update,
            payload=result,
        )
        evidence = result.get("evidence")
        if evidence:
            store.append_audit(
                req.session_id,
                actor_id,
                "query.completed",
                {
                    "query_id": evidence.get("query_id"),
                    "source": evidence.get("source"),
                    "rows": evidence.get("row_count", 0),
                    "is_synthetic": evidence.get("is_synthetic", True),
                },
            )
        return result

    @app.post("/v1/charts", status_code=201)
    def create_chart(req: ChartRequest, request: Request):
        actor_id = actor(request)
        try:
            turns_for_session = store.list_turns(req.session_id, owner_id=actor_id)
        except KeyError:
            raise HTTPException(404, "Session not found")
        analysis = next(
            (
                turn["payload"]
                for turn in reversed(turns_for_session)
                if turn["role"] == "assistant"
                and turn["payload"]
                and (turn["payload"].get("evidence") or {}).get("query_id") == req.query_id
                and turn["payload"].get("chart")
            ),
            None,
        )
        if analysis is None:
            raise HTTPException(404, "Chart analysis not found")
        try:
            artifact = charts.build(
                chart=analysis["chart"],
                evidence=analysis["evidence"],
                owner_id=actor_id,
            )
        except ValueError as exc:
            raise HTTPException(422, str(exc))
        store.register_artifact(
            req.session_id,
            actor_id,
            artifact.artifact_id,
            artifact.filename,
            artifact.size_bytes,
            artifact.slide_count,
            kind=artifact.kind,
            mime_type=artifact.mime_type,
            extension=artifact.extension,
        )
        store.append_audit(
            req.session_id,
            actor_id,
            "chart.created",
            {"artifact_id": artifact.artifact_id, "query_id": req.query_id},
        )
        return {
            "artifact_id": artifact.artifact_id,
            "filename": artifact.filename,
            "size_bytes": artifact.size_bytes,
            "slide_count": artifact.slide_count,
            "mime_type": artifact.mime_type,
            "kind": artifact.kind,
        }

    @app.post("/v1/presentations", status_code=201)
    def create_presentation(req: PresentationRequest, request: Request):
        actor_id = actor(request)
        try:
            turns_for_session = store.list_turns(req.session_id, owner_id=actor_id)
        except KeyError:
            raise HTTPException(404, "Session not found")
        analyses = [
            turn["payload"]
            for turn in turns_for_session
            if turn["role"] == "assistant"
            and turn["payload"]
            and turn["payload"].get("status") == "ok"
            and turn["payload"].get("evidence")
        ]
        if not analyses:
            raise HTTPException(409, "No evidence-backed analyses are available")
        try:
            artifact = presentations.build(
                title=req.title,
                analyses=analyses[-3:],
                owner_id=actor_id,
            )
        except ValueError as exc:
            raise HTTPException(422, str(exc))
        store.register_artifact(
            req.session_id,
            actor_id,
            artifact.artifact_id,
            artifact.filename,
            artifact.size_bytes,
            artifact.slide_count,
            kind="presentation",
            mime_type=artifact.mime_type,
            extension="pptx",
        )
        store.append_audit(
            req.session_id,
            actor_id,
            "presentation.created",
            {
                "artifact_id": artifact.artifact_id,
                "slide_count": artifact.slide_count,
                "analysis_count": min(len(analyses), 3),
            },
        )
        return {
            "artifact_id": artifact.artifact_id,
            "filename": artifact.filename,
            "size_bytes": artifact.size_bytes,
            "slide_count": artifact.slide_count,
            "mime_type": artifact.mime_type,
        }

    @app.get("/v1/artifacts/all")
    def list_all_artifacts(request: Request):
        return {"artifacts": store.list_owner_artifacts(actor(request))}

    @app.get("/v1/artifacts")
    def list_artifacts(session_id: str, request: Request):
        actor_id = actor(request)
        if not store.exists(session_id, actor_id):
            raise HTTPException(404, "Session not found")
        return {"artifacts": store.list_artifacts(session_id, actor_id)}

    @app.get("/v1/artifacts/{artifact_id}")
    def download_artifact(artifact_id: str, session_id: str, request: Request):
        actor_id = actor(request)
        if not _ARTIFACT_ID.fullmatch(artifact_id):
            raise HTTPException(404, "Artifact not found")
        allowed = {
            item["artifact_id"]: item
            for item in store.list_artifacts(session_id, actor_id)
        }
        metadata = allowed.get(artifact_id)
        if metadata is None:
            raise HTTPException(404, "Artifact not found")
        extension = metadata.get("extension", "pptx")
        path = artifact_path / f"{artifact_id}.{extension}"
        if not path.is_file() or path.stat().st_size != metadata["size_bytes"]:
            raise HTTPException(410, "Artifact is unavailable")
        return {
            **metadata,
            "mime_type": metadata.get("mime_type", PPTX_MIME),
            "content_base64": base64.b64encode(path.read_bytes()).decode("ascii"),
        }

    return app


app = create_app() if os.environ.get("BOLT_DESKTOP_CHILD") != "1" else None
