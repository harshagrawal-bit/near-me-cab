"""/api/payments — the payment ledger.

Deliberately provider-agnostic. `provider` is stored on every record so a
Razorpay (or any other gateway) integration can be added as a new provider
adapter plus a webhook route, without changing this collection's shape.
"""

from __future__ import annotations

import json
import logging

from fastapi import APIRouter, Depends, Header, Query, Request

from app.api.deps import AdminUser, CurrentUser, Pagination
from app.core.rate_limit import write_rate_limit
from app.core.errors import AuthError
from app.db import mongodb
from app.models.enums import PaymentStatus, Role
from app.schemas.common import build_page, object_id, serialize
from app.schemas.payment import (
    CheckoutCallback,
    PaymentApplied,
    PaymentIntentRequest,
    PaymentIntentResponse,
)
from app.services import payment_service, razorpay_service

logger = logging.getLogger("localride.payments")

router = APIRouter(prefix="/payments", tags=["payments"])


@router.get("", summary="Payment records (admin)")
async def list_payments(
    admin: AdminUser,
    page_params: Pagination,
    status_filter: str | None = Query(None, alias="status"),
    search: str | None = Query(None, max_length=60),
) -> dict:
    query: dict = {}
    if status_filter:
        query["status"] = status_filter
    if search:
        query["booking_reference"] = {"$regex": search.strip(), "$options": "i"}

    total = await mongodb.payments().count_documents(query)
    cursor = (
        mongodb.payments()
        .find(query)
        .sort("created_at", -1)
        .skip(page_params.skip)
        .limit(page_params.page_size)
    )
    items = []
    async for doc in cursor:
        item = serialize(doc)
        customer = await mongodb.users().find_one({"_id": doc["customer_id"]}, {"name": 1})
        item["customer_name"] = customer["name"] if customer else None
        items.append(item)
    return build_page(items, total, page_params.page, page_params.page_size)


@router.get("/methods", summary="Payment methods this deployment supports")
async def methods(user: CurrentUser) -> dict:
    """Reports what is actually wired up, not what the code could support.

    `online_enabled` follows the Razorpay key pair being present, so a
    deployment without keys degrades to cash and manual reconciliation rather
    than offering the customer a button that cannot work.
    """
    online = razorpay_service.is_configured()
    return {
        "online_enabled": online,
        "providers": [
            {"id": "manual", "label": "Recorded by operations", "enabled": True},
            {"id": "razorpay", "label": "Card, UPI, netbanking & wallets", "enabled": online},
        ],
        "methods": [
            {"id": "cash", "label": "Pay driver in cash", "enabled": True},
            {"id": "upi", "label": "UPI (record manually)", "enabled": True},
            {"id": "online", "label": "Pay online now", "enabled": online},
        ],
        "statuses": [status.value for status in PaymentStatus],
    }


@router.get("/booking/{booking_id}", summary="Payments for one booking")
async def payments_for_booking(booking_id: str, user: CurrentUser) -> list[dict]:
    booking_oid = object_id(booking_id, "booking_id")
    booking = await mongodb.bookings().find_one({"_id": booking_oid}, {"customer_id": 1})
    if not booking:
        return []
    if user["role"] == Role.CUSTOMER.value and booking["customer_id"] != user["_id"]:
        return []
    if user["role"] == Role.DRIVER.value:
        return []
    cursor = mongodb.payments().find({"booking_id": booking_oid}).sort("created_at", -1)
    return [serialize(doc) async for doc in cursor]


# ---------------------------------------------------------------------------
# Razorpay
# ---------------------------------------------------------------------------


@router.post(
    "/razorpay/order",
    response_model=PaymentIntentResponse,
    dependencies=[Depends(write_rate_limit)],
    summary="Start an online payment",
)
async def create_order(payload: PaymentIntentRequest, user: CurrentUser) -> PaymentIntentResponse:
    """Open a Razorpay order for an amount the server works out itself.

    The client names what it is paying for; it never names a price. For a fare
    that comes from the booking, and for a wallet top-up it is range-checked.
    """
    result = await payment_service.create_intent(
        user,
        purpose=payload.purpose,
        booking_id=payload.booking_id,
        amount=payload.amount,
    )
    return PaymentIntentResponse(**result)


@router.post(
    "/razorpay/verify",
    response_model=PaymentApplied,
    dependencies=[Depends(write_rate_limit)],
    summary="Confirm a checkout that has just succeeded",
)
async def verify_checkout(payload: CheckoutCallback, user: CurrentUser) -> PaymentApplied:
    """The fast path, so the customer sees confirmation immediately.

    Not the authoritative one: the webhook is, because a customer can close
    the browser the moment after paying and never reach this endpoint. Both
    routes apply the payment through the same idempotent claim, so whichever
    arrives first wins and the other is a no-op.
    """
    if not razorpay_service.verify_checkout_signature(
        order_id=payload.razorpay_order_id,
        payment_id=payload.razorpay_payment_id,
        signature=payload.razorpay_signature,
    ):
        raise AuthError("Payment signature could not be verified.")
    result = await payment_service.apply_payment(
        order_id=payload.razorpay_order_id,
        payment_id=payload.razorpay_payment_id,
        source="checkout",
    )
    return PaymentApplied(**result)


@router.post("/razorpay/webhook", summary="Razorpay server-to-server callback")
async def razorpay_webhook(
    request: Request,
    x_razorpay_signature: str = Header(default=""),
) -> dict:
    """Authoritative confirmation, straight from Razorpay.

    Deliberately unauthenticated — Razorpay holds no session — and therefore
    trusted *only* through its signature, which is computed over the raw
    request bytes. Reading `await request.body()` rather than a parsed model
    matters: re-serialising the JSON changes the bytes and every signature
    would fail.

    Always answers 200 once the signature checks out. Razorpay retries on any
    other status, and retrying a payment we have already applied is pointless
    noise — the claim in `payment_service` makes the repeat harmless anyway.
    """
    raw = await request.body()
    if not razorpay_service.verify_webhook_signature(
        raw_body=raw, signature=x_razorpay_signature
    ):
        logger.warning("Rejected a Razorpay webhook with a bad signature")
        raise AuthError("Invalid webhook signature.")

    body = json.loads(raw or b"{}")
    event = body.get("event", "")
    entities = body.get("payload", {})

    if event in {"payment.captured", "order.paid"}:
        payment = entities.get("payment", {}).get("entity", {})
        order_id = payment.get("order_id")
        payment_id = payment.get("id")
        if order_id and payment_id:
            await payment_service.apply_payment(
                order_id=order_id, payment_id=payment_id, source="webhook"
            )
    elif event == "payment.failed":
        payment = entities.get("payment", {}).get("entity", {})
        order_id = payment.get("order_id")
        if order_id:
            await payment_service.mark_failed(
                order_id=order_id, reason=payment.get("error_description")
            )

    return {"status": "ok"}
