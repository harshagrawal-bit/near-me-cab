"""Razorpay provider adapter: order creation and signature verification.

Talks to Razorpay over `httpx` rather than the official SDK. The SDK is
synchronous, so every call would block the event loop this app runs on, and
all it wraps is basic-auth HTTP plus an HMAC — both of which httpx and the
standard library already do. No new dependency.

Two different signatures are involved here and they are NOT interchangeable:

* the **checkout** signature — HMAC of ``order_id|payment_id`` keyed with the
  API *secret*, handed back by the browser after a successful payment, and
* the **webhook** signature — HMAC of the raw request body keyed with the
  *webhook* secret, sent server-to-server by Razorpay.

The webhook is the one that decides whether money really moved. A customer can
close the browser the instant after paying, and then the checkout callback
never arrives — but the webhook still does.
"""

from __future__ import annotations

import hashlib
import hmac
import logging
from typing import Any

import httpx

from app.core.config import settings
from app.core.errors import ValidationError

logger = logging.getLogger("localride.razorpay")

API_BASE = "https://api.razorpay.com/v1"

#: Razorpay rejects anything slower than this anyway, and a hung payment call
#: holding a worker open is worse than a failed one the customer can retry.
TIMEOUT_SECONDS = 20.0


def is_configured() -> bool:
    """Both halves of the key pair are required — the id alone cannot sign."""
    return bool(settings.RAZORPAY_KEY_ID and settings.RAZORPAY_KEY_SECRET)


def webhooks_configured() -> bool:
    return bool(settings.RAZORPAY_WEBHOOK_SECRET)


def public_key() -> str:
    """The key id is safe to hand the browser; the secret never leaves here."""
    return settings.RAZORPAY_KEY_ID


def to_paise(rupees: float) -> int:
    """Razorpay counts in paise, as integers.

    Rounded through `round()` rather than truncated by `int()`: at float
    precision a ₹1,234.35 fare can be held as 123434.99999, and truncating
    would quietly undercharge by a paisa on a run of bookings.
    """
    return int(round(float(rupees) * 100))


def to_rupees(paise: int) -> float:
    return round(int(paise) / 100, 2)


async def create_order(
    *, amount_rupees: float, receipt: str, notes: dict[str, Any] | None = None
) -> dict[str, Any]:
    """Create a Razorpay order for an amount *we* computed.

    The caller is responsible for deriving `amount_rupees` server-side. Nothing
    in this function questions it, so nothing above it may take it from a client.
    """
    if not is_configured():
        raise ValidationError("Online payments are not configured on this server.")
    amount = to_paise(amount_rupees)
    if amount <= 0:
        raise ValidationError("Payment amount must be greater than zero.")

    payload = {
        "amount": amount,
        "currency": "INR",
        # Razorpay caps receipts at 40 characters and rejects longer ones.
        "receipt": receipt[:40],
        "notes": notes or {},
    }
    async with httpx.AsyncClient(timeout=TIMEOUT_SECONDS) as client:
        response = await client.post(
            f"{API_BASE}/orders",
            json=payload,
            auth=(settings.RAZORPAY_KEY_ID, settings.RAZORPAY_KEY_SECRET),
        )
    if response.status_code >= 400:
        # Razorpay's body can carry the key id; log the reason, not the payload.
        logger.error("Razorpay order creation failed (%s)", response.status_code)
        raise ValidationError("Could not start the payment. Please try again.")
    return response.json()


async def create_refund(
    *, payment_id: str, amount_rupees: float, notes: dict[str, Any] | None = None
) -> dict[str, Any]:
    """Refund a captured payment, in full or in part.

    Razorpay is itself idempotent per refund request only if given a key, so
    callers must not retry blindly — the ledger row written alongside is what
    stops a second refund, not this function.
    """
    if not is_configured():
        raise ValidationError("Online payments are not configured on this server.")
    amount = to_paise(amount_rupees)
    if amount <= 0:
        raise ValidationError("Refund amount must be greater than zero.")

    async with httpx.AsyncClient(timeout=TIMEOUT_SECONDS) as client:
        response = await client.post(
            f"{API_BASE}/payments/{payment_id}/refund",
            json={"amount": amount, "notes": notes or {}, "speed": "normal"},
            auth=(settings.RAZORPAY_KEY_ID, settings.RAZORPAY_KEY_SECRET),
        )
    if response.status_code >= 400:
        logger.error(
            "Razorpay refund failed for %s (%s)", payment_id, response.status_code
        )
        raise ValidationError("The refund could not be processed. Please try again.")
    return response.json()


async def fetch_payment(payment_id: str) -> dict[str, Any] | None:
    """Read a payment back from Razorpay.

    Used to confirm status and amount independently of whatever arrived in a
    webhook body, so a forged-but-correctly-signed replay still cannot invent
    an amount we never charged.
    """
    if not is_configured():
        return None
    async with httpx.AsyncClient(timeout=TIMEOUT_SECONDS) as client:
        response = await client.get(
            f"{API_BASE}/payments/{payment_id}",
            auth=(settings.RAZORPAY_KEY_ID, settings.RAZORPAY_KEY_SECRET),
        )
    if response.status_code >= 400:
        logger.warning("Could not fetch Razorpay payment %s (%s)", payment_id, response.status_code)
        return None
    return response.json()


def _sign(message: bytes, secret: str) -> str:
    return hmac.new(secret.encode("utf-8"), message, hashlib.sha256).hexdigest()


def verify_checkout_signature(*, order_id: str, payment_id: str, signature: str) -> bool:
    """Verify the signature the browser returns after a successful checkout."""
    if not is_configured() or not signature:
        return False
    expected = _sign(f"{order_id}|{payment_id}".encode("utf-8"), settings.RAZORPAY_KEY_SECRET)
    # Constant-time: a plain `==` leaks, byte by byte, how much of a guess was
    # right, which is enough to forge a signature given enough attempts.
    return hmac.compare_digest(expected, signature)


def verify_webhook_signature(*, raw_body: bytes, signature: str) -> bool:
    """Verify a webhook against the raw request bytes.

    It must be the *raw* body. Parsing the JSON and re-serialising it changes
    key order and whitespace, the digest no longer matches, and every webhook
    fails verification for reasons that look nothing like the cause.
    """
    if not webhooks_configured() or not signature:
        return False
    expected = _sign(raw_body, settings.RAZORPAY_WEBHOOK_SECRET)
    return hmac.compare_digest(expected, signature)
