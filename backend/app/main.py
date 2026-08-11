"""LocalRide API entry point."""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request

from app.api.router import api_router
from app.core.config import settings
from app.core.errors import register_exception_handlers
from app.db.indexes import ensure_indexes
from app.db.mongodb import close_mongo_connection, connect_to_mongo

logging.basicConfig(
    level=logging.DEBUG if settings.DEBUG else logging.INFO,
    format="%(asctime)s %(levelname)-8s %(name)s | %(message)s",
)
# The Mongo driver logs every command at DEBUG, which drowns out our own logs
# and can echo document contents. Keep it at WARNING regardless of DEBUG.
for noisy in ("pymongo", "pymongo.command", "pymongo.connection", "pymongo.serverSelection"):
    logging.getLogger(noisy).setLevel(logging.WARNING)

logger = logging.getLogger("localride")


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings.assert_production_safe()
    await connect_to_mongo()
    await ensure_indexes()
    yield
    await close_mongo_connection()


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    """Conservative headers appropriate for a JSON API."""

    async def dispatch(self, request: Request, call_next):
        response = await call_next(request)
        response.headers.setdefault("X-Content-Type-Options", "nosniff")
        response.headers.setdefault("X-Frame-Options", "DENY")
        response.headers.setdefault("Referrer-Policy", "no-referrer")
        response.headers.setdefault(
            "Permissions-Policy", "geolocation=(self), microphone=(), camera=()"
        )
        if settings.is_production:
            response.headers.setdefault(
                "Strict-Transport-Security", "max-age=63072000; includeSubDomains"
            )
        return response


def create_app() -> FastAPI:
    app = FastAPI(
        title=settings.PROJECT_NAME,
        version="1.0.0",
        description=(
            "Booking, dispatch and administration API for a local cab and travel "
            "business. Fares are always calculated server-side."
        ),
        lifespan=lifespan,
        docs_url="/docs" if not settings.is_production else None,
        redoc_url=None,
        openapi_url="/openapi.json" if not settings.is_production else None,
    )

    app.add_middleware(SecurityHeadersMiddleware)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,  # required for the refresh cookie
        allow_methods=["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
        allow_headers=["Authorization", "Content-Type"],
        max_age=600,
    )

    register_exception_handlers(app)
    app.include_router(api_router, prefix=settings.API_V1_PREFIX)

    @app.get("/api/health", tags=["health"], summary="Liveness and database check")
    async def health() -> dict:
        from app.db.mongodb import get_db

        try:
            await get_db().command("ping")
            database = "ok"
        except Exception:  # pragma: no cover - depends on infrastructure
            logger.exception("Database health check failed")
            database = "unavailable"
        return {"status": "ok", "database": database, "environment": settings.ENV}

    return app


app = create_app()
