"""Verify Google Sign-In ID tokens.

Deliberately talks to Google directly rather than through a hosted auth vendor:
the user record stays in our own database, there is no per-user billing, and no
third party holds the customer list.

What arrives from the client is a Google-issued ID token (a JWT). It is only
trustworthy once the *signature* has been checked against Google's public keys
and the audience confirmed as our own client id. Decoding it without verifying
would let anyone mint a token claiming to be any email address — which is the
single most common way this integration is got wrong.
"""

from __future__ import annotations

import logging
from typing import Any

import jwt
from jwt import PyJWKClient

from app.core.config import settings
from app.core.errors import AuthError, ValidationError

logger = logging.getLogger("localride.google")

GOOGLE_CERTS_URL = "https://www.googleapis.com/oauth2/v3/certs"
GOOGLE_ISSUERS = {"accounts.google.com", "https://accounts.google.com"}

#: Cached across requests — refetching Google's keys on every sign-in would be
#: both slow and a good way to get rate limited. PyJWKClient handles the TTL.
_jwk_client: PyJWKClient | None = None


def is_configured() -> bool:
    return bool(settings.GOOGLE_CLIENT_ID)


def _client() -> PyJWKClient:
    global _jwk_client
    if _jwk_client is None:
        _jwk_client = PyJWKClient(GOOGLE_CERTS_URL, cache_keys=True)
    return _jwk_client


def verify_id_token(credential: str) -> dict[str, Any]:
    """Return the verified claims, or raise.

    Raises AuthError for anything that makes the token untrustworthy, with a
    deliberately vague message — a precise reason would help an attacker probe
    which part of the check they failed.
    """
    if not is_configured():
        raise ValidationError("Google sign-in is not configured on this server.")
    if not credential or credential.count(".") != 2:
        raise AuthError("Google sign-in failed.")

    try:
        signing_key = _client().get_signing_key_from_jwt(credential)
        claims = jwt.decode(
            credential,
            signing_key.key,
            algorithms=["RS256"],
            audience=settings.GOOGLE_CLIENT_ID,
            options={"require": ["exp", "iat", "aud", "iss", "sub"]},
        )
    except jwt.ExpiredSignatureError:
        raise AuthError("That Google sign-in has expired. Please try again.")
    except Exception as exc:  # noqa: BLE001 - any failure here means "do not trust it"
        # Log the type only. The token itself is a credential and must never
        # reach the logs.
        logger.warning("Google ID token rejected: %s", type(exc).__name__)
        raise AuthError("Google sign-in failed.")

    if claims.get("iss") not in GOOGLE_ISSUERS:
        raise AuthError("Google sign-in failed.")
    if not claims.get("email"):
        raise AuthError("That Google account has no email address attached.")
    if not claims.get("email_verified", False):
        # An unverified Google email could belong to someone else entirely.
        raise AuthError("Please verify your email address with Google first.")

    return {
        "sub": claims["sub"],
        "email": str(claims["email"]).lower(),
        "name": claims.get("name") or str(claims["email"]).split("@")[0],
        "picture": claims.get("picture"),
    }
