"""Fail-closed identity boundary for an organization-approved authentication proxy."""
from __future__ import annotations
from dataclasses import dataclass
import hmac
import re

from fastapi import HTTPException, Request


_SUBJECT = re.compile(r"^[A-Za-z0-9._@-]{1,200}$")
_ROLE = re.compile(r"^[A-Z0-9_-]{1,80}$")


@dataclass(frozen=True)
class Identity:
    subject: str
    roles: frozenset[str]


class EnterpriseIdentityResolver:
    """Trust headers only when accompanied by a strong proxy-to-BOLT secret.

    The upstream proxy remains responsible for actual SSO/OIDC authentication.
    Direct requests, unapproved roles and malformed identities fail closed.
    """

    def __init__(self, *, proxy_token: str, allowed_roles: frozenset[str]):
        if len(proxy_token) < 32:
            raise ValueError("Enterprise identity proxy secret must be at least 32 characters")
        if not allowed_roles or any(not _ROLE.fullmatch(role) for role in allowed_roles):
            raise ValueError("At least one valid enterprise role is required")
        self._proxy_token = proxy_token
        self._allowed_roles = allowed_roles

    def resolve(self, request: Request) -> Identity:
        provided = request.headers.get("x-bolt-proxy-token", "")
        if not hmac.compare_digest(provided, self._proxy_token):
            raise HTTPException(401, "Enterprise identity is required")
        subject = request.headers.get("x-bolt-user", "").strip()
        if not _SUBJECT.fullmatch(subject):
            raise HTTPException(401, "Enterprise identity is invalid")
        roles = frozenset(
            item.strip()
            for item in request.headers.get("x-bolt-roles", "").split(",")
            if item.strip()
        )
        if any(not _ROLE.fullmatch(role) for role in roles):
            raise HTTPException(403, "Enterprise role is invalid")
        if not roles.intersection(self._allowed_roles):
            raise HTTPException(403, "Enterprise role is not authorized")
        return Identity(subject=subject, roles=roles)
