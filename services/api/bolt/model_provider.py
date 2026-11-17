"""Runtime-only personal model connection for the authenticated desktop service."""
from __future__ import annotations
import json
from threading import RLock
from typing import Literal
from pydantic import BaseModel, ConfigDict, Field, SecretStr
from .model_gateway import GatewayConfig, OpenAICompatibleGateway, query_plan_from_gateway
from .semantic_catalog import catalog_payload


class ModelSettings(BaseModel):
    model_config = ConfigDict(extra="forbid")
    endpoint: str = Field(min_length=1, max_length=1000)
    model: str = Field(min_length=1, max_length=200)
    auth_mode: Literal["bearer", "apim", "none"] = "bearer"
    token: SecretStr = Field(default_factory=lambda: SecretStr(""), max_length=4096)
    timeout_seconds: int = Field(default=30, ge=1, le=120)


class ModelConnectionError(RuntimeError):
    """Public error without a provider response body or credential."""


class _PrivateGateway:
    def __init__(self, gateway):
        self._gateway = gateway
        self.last_usage = {}

    def plan(self, question, context, catalog):
        try:
            result = self._gateway.plan(question, context, catalog)
            query_plan_from_gateway(result)
            self.last_usage = dict(getattr(self._gateway, "last_usage", {}))
            return result
        except Exception:
            raise ModelConnectionError(
                "Model request failed. Check the endpoint, authentication and model name."
            ) from None


class LocalModelRuntime:
    def __init__(self, *, gateway_factory=OpenAICompatibleGateway):
        self._factory = gateway_factory
        self._config = None
        self._verified = False
        self._lock = RLock()

    def status(self):
        with self._lock:
            config = self._config
            return {
                "configured": config is not None,
                "verified": self._verified,
                "endpoint": config.endpoint if config else "",
                "model": config.model if config else "",
                "auth_mode": config.auth_mode if config else "bearer",
                "timeout_seconds": config.timeout_seconds if config else 30,
                "has_key": bool(config and config.token),
            }

    def configure(self, settings: ModelSettings):
        config = GatewayConfig(
            endpoint=settings.endpoint.strip().rstrip("/"),
            model=settings.model.strip(),
            token=settings.token.get_secret_value(),
            auth_mode=settings.auth_mode,
            timeout_seconds=settings.timeout_seconds,
        )
        OpenAICompatibleGateway(config)  # Validate before replacing a working connection.
        if config.auth_mode != "none" and not config.token:
            raise ValueError("Enter a key or select no authentication for a local provider")
        if config.auth_mode == "none" and config.token:
            raise ValueError("Remove the key when selecting no authentication")
        with self._lock:
            self._config = config
            self._verified = False
            return self.status()

    def gateway(self):
        with self._lock:
            config = self._config
        return _PrivateGateway(self._factory(config)) if config else None

    def test(self):
        with self._lock:
            config = self._config
            self._verified = False
        if config is None:
            raise LookupError("Save a model connection before testing")
        gateway = _PrivateGateway(self._factory(config))
        gateway.plan("Show 2026 revenue by region", {}, catalog_payload())
        with self._lock:
            if self._config is not config:
                raise LookupError("Model settings changed; test the current connection again")
            self._verified = True
            return self.status()

    def plan_data(self, request):
        from .local_data_plans import validate_data_plan
        request.validate_schema()
        with self._lock:
            config = self._config
        if config is None:
            raise LookupError("Configure a personal model in Settings first")
        try:
            gateway = self._factory(config)
            payload = gateway.plan_local(request.question, request.target,
                [column.model_dump() for column in request.columns])
            if config.token and config.token in json.dumps(payload, ensure_ascii=False):
                raise ValueError('Model response included a credential')
            plan = validate_data_plan(payload, request)
            usage = getattr(gateway, "last_usage", {})
            return {"plan": plan, "model": config.model, "usage": {
                key: value if type(value) is int and 0 <= value <= 1_000_000_000 else 0
                for key in ("prompt_tokens", "completion_tokens", "cached_tokens")
                for value in (usage.get(key, 0),)
            }}
        except Exception:
            raise ModelConnectionError(
                "The model could not return a supported CSV calculation plan. Check the connection or rephrase the question."
            ) from None

    def disconnect(self):
        with self._lock:
            self._config = None
            self._verified = False
            return self.status()
