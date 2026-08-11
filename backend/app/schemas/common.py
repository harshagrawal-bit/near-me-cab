"""Shared schema primitives and Mongo document serialisation."""

from __future__ import annotations

import datetime as dt
import re
from typing import Annotated, Any, Generic, TypeVar

from bson import ObjectId
from bson.errors import InvalidId
from pydantic import BaseModel, BeforeValidator, ConfigDict, Field

from app.core.errors import ValidationError

T = TypeVar("T")

# Indian mobile numbers, optionally prefixed with +91 / 0.
PHONE_RE = re.compile(r"^(?:\+91[\s-]?|0)?[6-9]\d{9}$")


def normalise_phone(value: str) -> str:
    raw = re.sub(r"[\s\-()]", "", (value or "").strip())
    if not PHONE_RE.match(raw):
        raise ValueError("Enter a valid 10-digit Indian mobile number.")
    digits = re.sub(r"^(\+91|0)", "", raw)
    return digits


Phone = Annotated[str, BeforeValidator(normalise_phone)]


def object_id(value: Any, field: str = "id") -> ObjectId:
    """Parse an untrusted id, raising a clean 422 rather than a 500."""
    if isinstance(value, ObjectId):
        return value
    try:
        return ObjectId(str(value))
    except (InvalidId, TypeError):
        raise ValidationError(f"'{field}' is not a valid identifier.")


def optional_object_id(value: Any, field: str = "id") -> ObjectId | None:
    if value in (None, "", "null"):
        return None
    return object_id(value, field)


def serialize(document: Any) -> Any:
    """Recursively convert Mongo/BSON types into JSON-friendly values.

    `_id` becomes `id`; nested ObjectIds become strings; datetimes become
    timezone-aware ISO 8601 strings.
    """
    if document is None:
        return None
    if isinstance(document, list):
        return [serialize(item) for item in document]
    if isinstance(document, ObjectId):
        return str(document)
    if isinstance(document, dt.datetime):
        aware = document if document.tzinfo else document.replace(tzinfo=dt.timezone.utc)
        return aware.astimezone(dt.timezone.utc).isoformat()
    if isinstance(document, dt.date):
        return document.isoformat()
    if isinstance(document, dict):
        out: dict[str, Any] = {}
        for key, value in document.items():
            out["id" if key == "_id" else key] = serialize(value)
        return out
    return document


class ApiModel(BaseModel):
    """Base for *request* schemas.

    `extra="forbid"` is a security control, not a nicety: it means a client
    cannot smuggle unexpected fields (a `total_fare`, a `role`, an `is_admin`)
    into a payload and have them silently accepted.
    """

    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True, populate_by_name=True)


class ResponseModel(BaseModel):
    """Base for *response* schemas — tolerant of extra document fields."""

    model_config = ConfigDict(extra="ignore", populate_by_name=True)


class Message(BaseModel):
    detail: str


class Page(BaseModel, Generic[T]):
    items: list[T]
    total: int
    page: int
    page_size: int
    pages: int


def build_page(items: list[Any], total: int, page: int, page_size: int) -> dict[str, Any]:
    pages = max(1, -(-total // page_size)) if page_size else 1
    return {
        "items": items,
        "total": total,
        "page": page,
        "page_size": page_size,
        "pages": pages,
    }


class PaginationParams(BaseModel):
    page: int = Field(1, ge=1, le=10_000)
    page_size: int = Field(20, ge=1, le=200)

    @property
    def skip(self) -> int:
        return (self.page - 1) * self.page_size


def utcnow() -> dt.datetime:
    return dt.datetime.now(dt.timezone.utc)


def ensure_aware(value: dt.datetime | None) -> dt.datetime | None:
    if value is None:
        return None
    return value if value.tzinfo else value.replace(tzinfo=dt.timezone.utc)
