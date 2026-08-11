"""Lightweight fixed-window rate limiter.

Deliberately in-process: it protects a single-worker deployment and the login
endpoints during development. For multi-worker or multi-instance production,
swap `_MemoryStore` for a Redis-backed store — the `RateLimiter` dependency
interface stays identical.
"""

from __future__ import annotations

import time
from collections import defaultdict
from typing import Callable

from fastapi import Request

from app.core.config import settings
from app.core.errors import RateLimitError


class _MemoryStore:
    def __init__(self) -> None:
        self._hits: dict[str, list[float]] = defaultdict(list)

    def hit(self, key: str, limit: int, window: int) -> bool:
        """Return True when the request is allowed."""
        now = time.monotonic()
        cutoff = now - window
        bucket = self._hits[key]
        # Drop expired timestamps, keeping the list bounded.
        fresh = [ts for ts in bucket if ts > cutoff]
        if len(fresh) >= limit:
            self._hits[key] = fresh
            return False
        fresh.append(now)
        self._hits[key] = fresh
        return True

    def reset(self) -> None:
        self._hits.clear()


store = _MemoryStore()


def _client_key(request: Request, scope: str) -> str:
    forwarded = request.headers.get("x-forwarded-for", "")
    ip = forwarded.split(",")[0].strip() if forwarded else (request.client.host if request.client else "unknown")
    return f"{scope}:{ip}"


def RateLimiter(scope: str, limit: int, window_seconds: int) -> Callable:
    """Build a FastAPI dependency enforcing `limit` requests per window."""

    async def dependency(request: Request) -> None:
        if not settings.RATE_LIMIT_ENABLED:
            return
        if not store.hit(_client_key(request, scope), limit, window_seconds):
            raise RateLimitError(
                "Too many requests. Please wait a moment and try again.",
            )

    return dependency


auth_rate_limit = RateLimiter(
    "auth", settings.AUTH_RATE_LIMIT, settings.AUTH_RATE_WINDOW_SECONDS
)
refresh_rate_limit = RateLimiter(
    "refresh", settings.REFRESH_RATE_LIMIT, settings.REFRESH_RATE_WINDOW_SECONDS
)
write_rate_limit = RateLimiter(
    "write", settings.WRITE_RATE_LIMIT, settings.WRITE_RATE_WINDOW_SECONDS
)
