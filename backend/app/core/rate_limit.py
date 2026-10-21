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
    """Identify the caller for rate-limiting purposes.

    Reads `X-Forwarded-For` from the **right**, not the left, and only as many
    hops as we actually run. The leftmost entry is whatever the client sent —
    nginx's `proxy_add_x_forwarded_for` appends the real address rather than
    replacing the header — so trusting position 0 let anyone defeat every limit
    in the app by varying one header, and grow the bucket store without bound
    while doing it.

    With `TRUSTED_PROXY_HOPS = 0` (the default, and correct for a server
    reached directly) the header is ignored entirely.
    """
    hops = settings.TRUSTED_PROXY_HOPS
    direct = request.client.host if request.client else "unknown"
    if hops <= 0:
        return f"{scope}:{direct}"

    chain = [part.strip() for part in request.headers.get("x-forwarded-for", "").split(",") if part.strip()]
    # The last entry was written by our own proxy; step back one per extra hop.
    index = len(chain) - hops
    ip = chain[index] if 0 <= index < len(chain) else direct
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

#: Public, unauthenticated endpoints. Tighter than the signed-in write limit
#: because there is no account behind a caller here — only an IP — so the only
#: thing standing between a scripted form and a few thousand junk bookings is
#: this number.
public_rate_limit = RateLimiter("public", 20, 60)
