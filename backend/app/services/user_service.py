"""User records shared by all three roles."""

from __future__ import annotations

from typing import Any

from bson import ObjectId
from pymongo.errors import DuplicateKeyError

from app.core.errors import ConflictError, NotFoundError
from app.core.security import hash_password
from app.db import mongodb
from app.models.enums import AccountStatus, Role
from app.schemas.common import serialize, utcnow

PUBLIC_PROJECTION = {"password_hash": 0}


def to_public(user: dict[str, Any] | None) -> dict[str, Any] | None:
    """Strip credentials before a user document leaves the service layer."""
    if not user:
        return None
    safe = {key: value for key, value in user.items() if key != "password_hash"}
    return serialize(safe)


async def create_user(
    *,
    name: str,
    email: str,
    phone: str | None,
    password: str | None,
    role: Role,
    avatar_url: str | None = None,
    auth_provider: str = "password",
    google_sub: str | None = None,
) -> dict[str, Any]:
    """Create an account.

    `phone` and `password` are optional because a Google sign-up supplies
    neither: Google does not hand over a phone number, and there is no password
    to hash. Such an account simply has no `password_hash`, so password login
    can never succeed for it (see `verify_password`). The user can add a phone
    number later from their profile.
    """
    now = utcnow()
    document = {
        "name": name.strip(),
        "email": email.lower().strip(),
        "phone": phone,
        "password_hash": hash_password(password) if password else None,
        "role": role.value,
        "status": AccountStatus.ACTIVE.value,
        "avatar_url": avatar_url,
        "auth_provider": auth_provider,
        "google_sub": google_sub,
        "saved_locations": [],
        "created_at": now,
        "updated_at": now,
        "last_login_at": None,
    }
    try:
        result = await mongodb.users().insert_one(document)
    except DuplicateKeyError as exc:
        field = "email" if "email" in str(exc) else "phone number"
        raise ConflictError(f"An account with this {field} already exists.")
    document["_id"] = result.inserted_id
    return document


async def get_by_id(user_id: ObjectId, *, include_password: bool = False) -> dict[str, Any] | None:
    projection = None if include_password else PUBLIC_PROJECTION
    return await mongodb.users().find_one({"_id": user_id}, projection)


async def require_by_id(user_id: ObjectId) -> dict[str, Any]:
    user = await get_by_id(user_id)
    if not user:
        raise NotFoundError("User not found.")
    return user


async def get_by_email(email: str, *, include_password: bool = False) -> dict[str, Any] | None:
    projection = None if include_password else PUBLIC_PROJECTION
    return await mongodb.users().find_one({"email": email.lower().strip()}, projection)


async def update_user(user_id: ObjectId, changes: dict[str, Any]) -> dict[str, Any]:
    changes = {key: value for key, value in changes.items() if value is not None}
    if not changes:
        return await require_by_id(user_id)
    changes["updated_at"] = utcnow()
    try:
        result = await mongodb.users().update_one({"_id": user_id}, {"$set": changes})
    except DuplicateKeyError as exc:
        field = "email" if "email" in str(exc) else "phone number"
        raise ConflictError(f"Another account already uses this {field}.")
    if result.matched_count == 0:
        raise NotFoundError("User not found.")
    return await require_by_id(user_id)


async def set_password(user_id: ObjectId, new_password: str) -> None:
    await mongodb.users().update_one(
        {"_id": user_id},
        {"$set": {"password_hash": hash_password(new_password), "updated_at": utcnow()}},
    )


async def touch_login(user_id: ObjectId) -> None:
    await mongodb.users().update_one({"_id": user_id}, {"$set": {"last_login_at": utcnow()}})


async def set_status(user_id: ObjectId, status: AccountStatus, reason: str | None = None) -> dict:
    changes: dict[str, Any] = {"status": status.value, "updated_at": utcnow()}
    changes["suspension_reason"] = reason if status == AccountStatus.SUSPENDED else None
    result = await mongodb.users().update_one({"_id": user_id}, {"$set": changes})
    if result.matched_count == 0:
        raise NotFoundError("User not found.")
    return await require_by_id(user_id)


async def get_admin_recipients() -> list[ObjectId]:
    cursor = mongodb.users().find(
        {"role": Role.ADMIN.value, "status": AccountStatus.ACTIVE.value}, {"_id": 1}
    )
    return [doc["_id"] async for doc in cursor]
