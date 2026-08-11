"""Domain exceptions and the global exception handlers.

Users never see stack traces or driver-level error text — handlers translate
everything into a stable `{"detail": ..., "code": ...}` envelope.
"""

from __future__ import annotations

import logging

from fastapi import FastAPI, Request, status
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

logger = logging.getLogger("localride")


class AppError(Exception):
    """Base class for expected, user-presentable failures."""

    status_code: int = status.HTTP_400_BAD_REQUEST
    code: str = "app_error"

    def __init__(self, detail: str, *, code: str | None = None, status_code: int | None = None):
        super().__init__(detail)
        self.detail = detail
        if code:
            self.code = code
        if status_code:
            self.status_code = status_code


class NotFoundError(AppError):
    status_code = status.HTTP_404_NOT_FOUND
    code = "not_found"


class ConflictError(AppError):
    status_code = status.HTTP_409_CONFLICT
    code = "conflict"


class ValidationError(AppError):
    status_code = status.HTTP_422_UNPROCESSABLE_ENTITY
    code = "validation_error"


class AuthError(AppError):
    status_code = status.HTTP_401_UNAUTHORIZED
    code = "unauthorized"


class PermissionError_(AppError):
    status_code = status.HTTP_403_FORBIDDEN
    code = "forbidden"


class RateLimitError(AppError):
    status_code = status.HTTP_429_TOO_MANY_REQUESTS
    code = "rate_limited"


def _envelope(status_code: int, detail: str, code: str, **extra) -> JSONResponse:
    body = {"detail": detail, "code": code}
    body.update(extra)
    return JSONResponse(status_code=status_code, content=body)


def register_exception_handlers(app: FastAPI) -> None:
    @app.exception_handler(AppError)
    async def _app_error(_: Request, exc: AppError) -> JSONResponse:
        return _envelope(exc.status_code, exc.detail, exc.code)

    @app.exception_handler(StarletteHTTPException)
    async def _http_error(_: Request, exc: StarletteHTTPException) -> JSONResponse:
        detail = exc.detail if isinstance(exc.detail, str) else "Request could not be completed."
        code = {
            401: "unauthorized",
            403: "forbidden",
            404: "not_found",
            405: "method_not_allowed",
            429: "rate_limited",
        }.get(exc.status_code, "http_error")
        return _envelope(exc.status_code, detail, code)

    @app.exception_handler(RequestValidationError)
    async def _validation_error(_: Request, exc: RequestValidationError) -> JSONResponse:
        fields = {}
        for err in exc.errors():
            location = [str(part) for part in err["loc"] if part not in ("body", "query", "path")]
            fields[".".join(location) or "request"] = err["msg"]
        return _envelope(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            "Please correct the highlighted fields.",
            "validation_error",
            fields=fields,
        )

    @app.exception_handler(Exception)
    async def _unhandled(request: Request, exc: Exception) -> JSONResponse:
        # Log server-side with context, return an opaque message to the client.
        logger.exception("Unhandled error on %s %s", request.method, request.url.path)
        return _envelope(
            status.HTTP_500_INTERNAL_SERVER_ERROR,
            "Something went wrong on our side. Please try again.",
            "internal_error",
        )
