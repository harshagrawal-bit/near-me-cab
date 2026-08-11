"""Password hashing and JWT issuing/verification."""

from __future__ import annotations

import datetime as dt
import uuid
from typing import Any, Literal

import bcrypt
import jwt

from app.core.config import settings

TokenType = Literal["access", "refresh"]

# bcrypt truncates silently at 72 bytes; we reject longer input instead.
MAX_PASSWORD_BYTES = 72


def hash_password(plain: str) -> str:
    encoded = plain.encode("utf-8")
    if len(encoded) > MAX_PASSWORD_BYTES:
        raise ValueError("Password is too long (maximum 72 bytes).")
    return bcrypt.hashpw(encoded, bcrypt.gensalt(rounds=12)).decode("utf-8")


def verify_password(plain: str, hashed: str | None) -> bool:
    # A Google-only account has no password hash at all. Without this guard
    # `None.encode(...)` raises AttributeError — which is not a failed login,
    # it is a 500 — and every password attempt on such an account would crash
    # instead of being cleanly rejected.
    if not plain or not hashed:
        return False
    try:
        return bcrypt.checkpw(plain.encode("utf-8")[:MAX_PASSWORD_BYTES], hashed.encode("utf-8"))
    except (ValueError, TypeError, AttributeError):
        return False


def _now() -> dt.datetime:
    return dt.datetime.now(dt.timezone.utc)


def create_token(
    subject: str,
    role: str,
    token_type: TokenType,
    expires_delta: dt.timedelta | None = None,
) -> str:
    if expires_delta is None:
        expires_delta = (
            dt.timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
            if token_type == "access"
            else dt.timedelta(days=settings.REFRESH_TOKEN_EXPIRE_DAYS)
        )
    issued_at = _now()
    payload: dict[str, Any] = {
        "sub": subject,
        "role": role,
        "type": token_type,
        "iat": issued_at,
        "exp": issued_at + expires_delta,
        "jti": uuid.uuid4().hex,
    }
    return jwt.encode(payload, settings.JWT_SECRET, algorithm=settings.JWT_ALGORITHM)


def create_access_token(subject: str, role: str) -> str:
    return create_token(subject, role, "access")


def create_refresh_token(subject: str, role: str) -> str:
    return create_token(subject, role, "refresh")


def decode_token(token: str, expected_type: TokenType) -> dict[str, Any]:
    """Decode and validate a JWT. Raises jwt.PyJWTError on any problem."""
    payload = jwt.decode(token, settings.JWT_SECRET, algorithms=[settings.JWT_ALGORITHM])
    if payload.get("type") != expected_type:
        raise jwt.InvalidTokenError("Unexpected token type.")
    if not payload.get("sub"):
        raise jwt.InvalidTokenError("Token is missing a subject.")
    return payload


def access_token_expiry_seconds() -> int:
    return settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60
