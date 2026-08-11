"""Registration, login and token refresh."""

from __future__ import annotations

from typing import Any

import jwt
from bson import ObjectId

from app.core.errors import AuthError, PermissionError_
from app.core.security import (
    access_token_expiry_seconds,
    create_access_token,
    create_refresh_token,
    decode_token,
    verify_password,
)
from app.db import mongodb
from app.models.enums import AccountStatus, Role
from app.schemas.auth import LoginRequest, RegisterRequest
from app.schemas.common import utcnow
from app.services import google_auth, notification_service, user_service
from app.models.enums import NotificationType

# Deliberately identical for "no such user" and "wrong password" so the API
# cannot be used to enumerate registered accounts.
INVALID_CREDENTIALS = "Email or password is incorrect."


def _session_payload(user: dict[str, Any]) -> dict[str, Any]:
    public = user_service.to_public(user)
    return {
        "access_token": create_access_token(str(user["_id"]), user["role"]),
        "token_type": "bearer",
        "expires_in": access_token_expiry_seconds(),
        "user": public,
    }


def refresh_token_for(user: dict[str, Any]) -> str:
    return create_refresh_token(str(user["_id"]), user["role"])


def session_for(user: dict[str, Any]) -> dict[str, Any]:
    """Public wrapper so other services can mint a session after creating a user."""
    return _session_payload(user)


async def register_customer(payload: RegisterRequest) -> tuple[dict[str, Any], dict[str, Any]]:
    """Public sign-up. Only ever creates a customer — never a driver or admin."""
    user = await user_service.create_user(
        name=payload.name,
        email=payload.email,
        phone=payload.phone,
        password=payload.password,
        role=Role.CUSTOMER,
    )
    await notification_service.notify(
        user_id=user["_id"],
        notification_type=NotificationType.ACCOUNT,
        title="Welcome aboard",
        body="Your account is ready. Book your first trip whenever you like.",
    )
    return _session_payload(user), user


async def sign_in_with_google(credential: str) -> tuple[dict[str, Any], dict[str, Any], bool]:
    """Sign in — or sign up — using a verified Google ID token.

    Returns `(session, user, created)`.

    Linking rule: if the email already exists, we attach the Google identity to
    that account rather than creating a second one. This is safe *only* because
    `verify_id_token` requires `email_verified`; without that check, anyone
    could create a Google account claiming someone else's address and take over
    the existing login.

    A brand new account is always a CUSTOMER. Drivers become drivers by going
    through driver signup, which needs a licence — one tap should never be
    enough to become a driver, and never enough to become an admin.
    """
    profile = google_auth.verify_id_token(credential)

    user = await user_service.get_by_email(profile["email"])
    created = False

    if user is None:
        user = await user_service.create_user(
            name=profile["name"],
            email=profile["email"],
            phone=None,
            password=None,
            role=Role.CUSTOMER,
            avatar_url=profile.get("picture"),
            auth_provider="google",
            google_sub=profile["sub"],
        )
        created = True
        await notification_service.notify(
            user_id=user["_id"],
            notification_type=NotificationType.ACCOUNT,
            title="Welcome aboard",
            body="Your account is ready. Book your first trip whenever you like.",
        )
    else:
        if user.get("status") != AccountStatus.ACTIVE.value:
            raise PermissionError_("This account has been suspended. Please contact support.")
        # Record the link on first Google sign-in to an existing password account.
        if not user.get("google_sub"):
            await mongodb.users().update_one(
                {"_id": user["_id"]},
                {"$set": {"google_sub": profile["sub"], "updated_at": utcnow()}},
            )
        await user_service.touch_login(user["_id"])

    return _session_payload(user), user, created


async def authenticate(payload: LoginRequest) -> tuple[dict[str, Any], dict[str, Any]]:
    user = await user_service.get_by_email(payload.email, include_password=True)
    if not user or not verify_password(payload.password, user.get("password_hash", "")):
        raise AuthError(INVALID_CREDENTIALS)
    if user.get("status") != AccountStatus.ACTIVE.value:
        raise PermissionError_("This account has been suspended. Please contact support.")
    await user_service.touch_login(user["_id"])
    return _session_payload(user), user


async def refresh_session(refresh_token: str | None) -> tuple[dict[str, Any], dict[str, Any]]:
    if not refresh_token:
        raise AuthError("Your session has expired. Please sign in again.")
    try:
        payload = decode_token(refresh_token, "refresh")
    except jwt.PyJWTError:
        raise AuthError("Your session has expired. Please sign in again.")

    user = await user_service.get_by_id(ObjectId(payload["sub"]))
    if not user:
        raise AuthError("Your session has expired. Please sign in again.")
    if user.get("status") != AccountStatus.ACTIVE.value:
        raise PermissionError_("This account has been suspended. Please contact support.")
    return _session_payload(user), user
