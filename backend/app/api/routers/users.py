"""/api/users — the signed-in user's own profile."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Query, Response

from app.core.config import settings
from app.core.rate_limit import write_rate_limit
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


@router.get("/me/deletion-check", summary="Can this account be closed?")
async def deletion_check(user: CurrentUser) -> dict:
    """Told up front, so nobody discovers a blocker halfway through."""
    blockers = await user_service.deletion_blockers(user)
    return {"can_delete": not blockers, "blockers": blockers}


@router.delete(
    "/me",
    dependencies=[Depends(write_rate_limit)],
    summary="Close my account permanently",
)
async def delete_me(
    response: Response,
    user: CurrentUser,
    reason: str | None = Query(None, max_length=300),
) -> dict:
    """Required by the Play Store, and the right thing regardless.

    Identity is removed; bookings and payments stay, because they are financial
    records with their own retention rules and a ledger that cannot explain
    itself is worse than one that remembers a closed account.
    """
    result = await user_service.delete_account(user, reason=reason)
    response.delete_cookie(key=settings.REFRESH_COOKIE_NAME, path="/")
    return result
