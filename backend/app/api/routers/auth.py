"""/api/auth — registration, login, refresh, logout, password change."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Request, Response, status

from app.api.deps import CurrentUser
from app.core.config import settings
from app.core.errors import AuthError
from app.core.rate_limit import auth_rate_limit, refresh_rate_limit
from app.core.security import verify_password
from app.schemas.auth import (
    ChangePasswordRequest,
    GoogleSignIn,
    LoginRequest,
    RegisterRequest,
    TokenResponse,
)
from app.schemas.common import Message
from app.schemas.wallet import DriverSignup
from app.services import auth_service, fleet_service, google_auth, user_service

router = APIRouter(prefix="/auth", tags=["auth"])


def _set_refresh_cookie(response: Response, token: str) -> None:
    response.set_cookie(
        key=settings.REFRESH_COOKIE_NAME,
        value=token,
        httponly=True,
        secure=settings.COOKIE_SECURE,
        samesite=settings.COOKIE_SAMESITE,
        domain=settings.COOKIE_DOMAIN,
        max_age=settings.REFRESH_TOKEN_EXPIRE_DAYS * 24 * 3600,
        path="/",
    )


def _clear_refresh_cookie(response: Response) -> None:
    response.delete_cookie(
        key=settings.REFRESH_COOKIE_NAME,
        domain=settings.COOKIE_DOMAIN,
        path="/",
    )


@router.post(
    "/register",
    response_model=TokenResponse,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(auth_rate_limit)],
    summary="Create a customer account",
)
async def register(payload: RegisterRequest, response: Response) -> TokenResponse:
    session, user = await auth_service.register_customer(payload)
    _set_refresh_cookie(response, auth_service.refresh_token_for(user))
    return TokenResponse(**session)


@router.post(
    "/login",
    response_model=TokenResponse,
    dependencies=[Depends(auth_rate_limit)],
    summary="Sign in with email and password",
)
async def login(payload: LoginRequest, response: Response) -> TokenResponse:
    session, user = await auth_service.authenticate(payload)
    _set_refresh_cookie(response, auth_service.refresh_token_for(user))
    return TokenResponse(**session)


@router.post(
    "/google",
    response_model=TokenResponse,
    dependencies=[Depends(auth_rate_limit)],
    summary="Sign in or sign up with a Google ID token",
)
async def google_sign_in(payload: GoogleSignIn, response: Response) -> TokenResponse:
    session, user, _created = await auth_service.sign_in_with_google(payload.credential)
    _set_refresh_cookie(response, auth_service.refresh_token_for(user))
    return TokenResponse(**session)


@router.post(
    "/driver-signup",
    response_model=TokenResponse,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(auth_rate_limit)],
    summary="Sign up as a driver / fleet owner",
)
async def driver_signup(payload: DriverSignup, response: Response) -> TokenResponse:
    """Public driver registration.

    Creates an unverified fleet owner with a zero wallet. They cannot accept
    work until an admin verifies their documents and the deposit is funded —
    both enforced server-side in `fleet_service.accept_booking`.
    """
    _driver, user = await fleet_service.signup_owner(payload)
    session = auth_service.session_for(user)
    _set_refresh_cookie(response, auth_service.refresh_token_for(user))
    return TokenResponse(**session)


@router.get("/providers", summary="Which sign-in methods this server supports")
async def providers() -> dict:
    """Lets the frontend hide the Google button when it is not configured,
    instead of showing one that cannot possibly work."""
    return {"password": True, "google": google_auth.is_configured()}


@router.post(
    "/refresh",
    response_model=TokenResponse,
    dependencies=[Depends(refresh_rate_limit)],
    summary="Exchange the refresh cookie for a new access token",
)
async def refresh(request: Request, response: Response) -> TokenResponse:
    token = request.cookies.get(settings.REFRESH_COOKIE_NAME)
    session, user = await auth_service.refresh_session(token)
    _set_refresh_cookie(response, auth_service.refresh_token_for(user))
    return TokenResponse(**session)


@router.post("/logout", response_model=Message, summary="Clear the refresh session")
async def logout(response: Response) -> Message:
    _clear_refresh_cookie(response)
    return Message(detail="Signed out.")


@router.post(
    "/change-password",
    response_model=Message,
    dependencies=[Depends(auth_rate_limit)],
    summary="Change your own password",
)
async def change_password(payload: ChangePasswordRequest, user: CurrentUser) -> Message:
    stored = await user_service.get_by_id(user["_id"], include_password=True)
    if not stored or not verify_password(payload.current_password, stored.get("password_hash", "")):
        raise AuthError("Your current password is incorrect.")
    await user_service.set_password(user["_id"], payload.new_password)
    return Message(detail="Password updated.")
