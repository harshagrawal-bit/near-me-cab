"""/api/users — the signed-in user's own profile."""

from __future__ import annotations

from fastapi import APIRouter

from app.api.deps import CurrentUser
from app.schemas.auth import UpdateProfileRequest, UserPublic
from app.schemas.common import serialize
from app.services import driver_service, settings_service, user_service

router = APIRouter(prefix="/users", tags=["users"])


@router.get("/me", summary="Current user profile")
async def me(user: CurrentUser) -> dict:
    payload = {"user": user_service.to_public(user)}
    if user["role"] == "driver":
        driver = await driver_service.get_by_user_id(user["_id"])
        payload["driver"] = serialize(driver) if driver else None
    return payload


@router.patch("/me", response_model=UserPublic, summary="Update your profile")
async def update_me(payload: UpdateProfileRequest, user: CurrentUser) -> UserPublic:
    changes = payload.model_dump(exclude_unset=True, exclude_none=True)
    if "saved_locations" in changes:
        changes["saved_locations"] = [
            location.model_dump() for location in (payload.saved_locations or [])
        ]
    updated = await user_service.update_user(user["_id"], changes)
    return UserPublic(**user_service.to_public(updated))


@router.get("/me/settings", summary="Public app settings for the current session")
async def app_settings(user: CurrentUser) -> dict:
    return await settings_service.get_public_settings()
