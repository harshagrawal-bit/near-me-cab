"""Online payment orchestration: what a Razorpay payment actually *means*.

`razorpay_service` knows how to talk to Razorpay. This module knows what a
successful payment should do — confirm a booking's advance, settle its
outstanding balance, or top up a driver's security deposit.

Idempotency lives here, and it is the whole point of the module. Razorpay
retries a webhook until it gets a 2xx, and the browser's checkout callback can
arrive for the same payment at the same moment. Every application therefore
goes through one atomic compare-and-set on an intent record: the first caller
to move it out of `created` does the work, and everyone else is a no-op that
still answers 200. Without that, a retried webhook credits a wallet twice.

The intent also carries the amount *we* computed when the order was created,
so the figure that reaches a booking or a wallet never comes from the client
and never comes from a webhook body.
"""

from __future__ import annotations

import logging
from typing import Any

from bson import ObjectId

from app.core.errors import ConflictError, NotFoundError, ValidationError
from app.db import mongodb
from app.models.enums import (
    AdvanceStatus,
    BookingStatus,
    PaymentMethod,
    PaymentStatus,
    Role,
    WalletTxnType,
)
from app.schemas.common import serialize, utcnow
from app.services import razorpay_service

logger = logging.getLogger("localride.payments")

PURPOSE_ADVANCE = "advance"
PURPOSE_BALANCE = "balance"
PURPOSE_WALLET_TOPUP = "wallet_topup"
PURPOSES = {PURPOSE_ADVANCE, PURPOSE_BALANCE, PURPOSE_WALLET_TOPUP}

#: Deposit bounds. A wallet top-up is the one amount a user legitimately
#: chooses, so it is range-checked rather than derived.
MIN_TOPUP = 100.0
MAX_TOPUP = 200_000.0


def _oid(value: ObjectId | str) -> ObjectId:
    return value if isinstance(value, ObjectId) else ObjectId(str(value))


# ---------------------------------------------------------------------------
# Creating an intent
# ---------------------------------------------------------------------------


async def _amount_for_advance(user: dict[str, Any], booking_oid: ObjectId) -> dict[str, Any]:
    booking = await mongodb.bookings().find_one({"_id": booking_oid})
    if not booking or booking["customer_id"] != user["_id"]:
        # 404 rather than 403, matching the rest of the API: a customer must
        # not be able to probe which booking ids exist.
        raise NotFoundError("Booking not found.")
    if booking["status"] != BookingStatus.AWAITING_PAYMENT.value:
        raise ConflictError("This booking is not waiting for an advance payment.")
    if booking.get("advance_status") == AdvanceStatus.PAID.value:
        raise ConflictError("The advance has already been paid.")
    amount = float(booking.get("advance_amount") or 0)
    if amount <= 0:
        raise ConflictError("This booking does not require an advance.")
    return {"amount": amount, "booking": booking}


async def _amount_for_balance(user: dict[str, Any], booking_oid: ObjectId) -> dict[str, Any]:
    booking = await mongodb.bookings().find_one({"_id": booking_oid})
    if not booking or booking["customer_id"] != user["_id"]:
        raise NotFoundError("Booking not found.")
    if booking["status"] == BookingStatus.CANCELLED.value:
        raise ConflictError("This booking was cancelled.")
    outstanding = round(
        float(booking.get("total_fare") or 0) - float(booking.get("amount_paid") or 0), 2
    )
    if outstanding <= 0:
        raise ConflictError("This booking is already paid in full.")
    return {"amount": outstanding, "booking": booking}


async def _amount_for_topup(user: dict[str, Any], amount: float | None) -> dict[str, Any]:
    from app.services import driver_service

    if user["role"] != Role.DRIVER.value:
        raise ValidationError("Only driver accounts hold a wallet.")
    driver = await driver_service.require_driver_for_user(user["_id"])
    if amount is None:
        raise ValidationError("Enter an amount to add.")
    amount = round(float(amount), 2)
    if amount < MIN_TOPUP or amount > MAX_TOPUP:
        raise ValidationError(
            f"Enter an amount between ₹{MIN_TOPUP:,.0f} and ₹{MAX_TOPUP:,.0f}."
        )
    return {"amount": amount, "driver": driver}


async def create_intent(
    user: dict[str, Any],
    *,
    purpose: str,
    booking_id: str | None = None,
    amount: float | None = None,
) -> dict[str, Any]:
    """Work out what is owed, open a Razorpay order, and remember both."""
    if purpose not in PURPOSES:
        raise ValidationError("Unknown payment purpose.")
    if not razorpay_service.is_configured():
        raise ValidationError("Online payments are not enabled on this server.")

    booking_oid: ObjectId | None = None
    driver_oid: ObjectId | None = None
    reference = ""

    if purpose in {PURPOSE_ADVANCE, PURPOSE_BALANCE}:
        if not booking_id:
            raise ValidationError("A booking is required for this payment.")
        booking_oid = _oid(booking_id)
        resolved = (
            await _amount_for_advance(user, booking_oid)
            if purpose == PURPOSE_ADVANCE
            else await _amount_for_balance(user, booking_oid)
        )
        due = resolved["amount"]
        reference = resolved["booking"]["booking_id"]
    else:
        resolved = await _amount_for_topup(user, amount)
        due = resolved["amount"]
        driver_oid = resolved["driver"]["_id"]
        reference = f"wallet-{driver_oid}"

    order = await razorpay_service.create_order(
        amount_rupees=due,
        receipt=f"{purpose[:3]}-{reference}"[:40],
        notes={"purpose": purpose, "reference": reference, "user_id": str(user["_id"])},
    )

    now = utcnow()
    intent = {
        "order_id": order["id"],
        "purpose": purpose,
        "status": "created",
        "amount": due,
        "amount_paise": order["amount"],
        "user_id": user["_id"],
        "booking_id": booking_oid,
        "driver_id": driver_oid,
        "provider": "razorpay",
        "provider_payment_id": None,
        "created_at": now,
        "updated_at": now,
    }
    await mongodb.payment_intents().insert_one(intent)

    return {
        "order_id": order["id"],
        "amount": due,
        "amount_paise": order["amount"],
        "currency": order.get("currency", "INR"),
        "key_id": razorpay_service.public_key(),
        "purpose": purpose,
        "name": user.get("name"),
        "email": user.get("email"),
        "phone": user.get("phone"),
    }


# ---------------------------------------------------------------------------
# Applying a payment
# ---------------------------------------------------------------------------


async def apply_payment(*, order_id: str, payment_id: str, source: str) -> dict[str, Any]:
    """Apply a paid order exactly once.

    `source` is only for the audit trail — "checkout" when the browser came
    back, "webhook" when Razorpay told us server-to-server. Both funnel here
    so that whichever arrives first wins and the second is a no-op.
    """
    now = utcnow()

    # The claim. Only a document still in `created` is moved to `processing`,
    # and only one caller can win that race, so only one caller proceeds.
    intent = await mongodb.payment_intents().find_one_and_update(
        {"order_id": order_id, "status": "created"},
        {
            "$set": {
                "status": "processing",
                "provider_payment_id": payment_id,
                "claimed_by": source,
                "updated_at": now,
            }
        },
        return_document=True,
    )

    if intent is None:
        existing = await mongodb.payment_intents().find_one({"order_id": order_id})
        if existing is None:
            # An order we never created. Never invent a credit for it.
            raise NotFoundError("Unknown payment order.")
        logger.info(
            "Razorpay order %s already %s; ignoring duplicate from %s",
            order_id,
            existing["status"],
            source,
        )
        return {"applied": False, "status": existing["status"], "purpose": existing["purpose"]}

    try:
        await _perform(intent, payment_id=payment_id)
    except Exception:
        # Leave the intent in `processing` rather than rolling it back to
        # `created`: a retry must not re-run a side effect that may have half
        # happened. It surfaces to operations instead of silently double-paying.
        await mongodb.payment_intents().update_one(
            {"_id": intent["_id"]},
            {"$set": {"status": "needs_attention", "updated_at": utcnow()}},
        )
        logger.exception("Failed to apply Razorpay order %s", order_id)
        raise

    await mongodb.payment_intents().update_one(
        {"_id": intent["_id"]},
        {"$set": {"status": "paid", "paid_at": utcnow(), "updated_at": utcnow()}},
    )
    return {"applied": True, "status": "paid", "purpose": intent["purpose"]}


async def _perform(intent: dict[str, Any], *, payment_id: str) -> None:
    """Route a confirmed payment to whatever it was for."""
    from app.services import booking_service, wallet_service

    purpose = intent["purpose"]
    amount = float(intent["amount"])

    if purpose == PURPOSE_ADVANCE:
        await booking_service.pay_advance(
            intent["booking_id"],
            actor_id=intent["user_id"],
            actor_role=Role.CUSTOMER.value,
            provider="razorpay",
            reference=payment_id,
        )
    elif purpose == PURPOSE_BALANCE:
        from app.schemas.booking import PaymentRecord

        await booking_service.record_payment(
            intent["booking_id"],
            PaymentRecord(
                amount=amount,
                method=PaymentMethod.UPI,
                status=PaymentStatus.PAID,
                reference=payment_id,
                note="Paid online via Razorpay",
            ),
            actor_id=intent["user_id"],
        )
    elif purpose == PURPOSE_WALLET_TOPUP:
        await wallet_service.credit(
            intent["driver_id"],
            amount,
            txn_type=WalletTxnType.DEPOSIT,
            note="Security deposit paid online",
            actor_id=str(intent["user_id"]),
        )
    else:  # pragma: no cover - guarded at creation
        raise ValidationError("Unknown payment purpose.")


async def mark_failed(*, order_id: str, reason: str | None = None) -> None:
    """Record a failed attempt without closing the order to a later retry."""
    await mongodb.payment_intents().update_one(
        {"order_id": order_id, "status": "created"},
        {"$set": {"last_failure": reason, "updated_at": utcnow()}},
    )


async def intent_for_order(order_id: str) -> dict[str, Any] | None:
    doc = await mongodb.payment_intents().find_one({"order_id": order_id})
    return serialize(doc) if doc else None


# ---------------------------------------------------------------------------
# Refunds
# ---------------------------------------------------------------------------


async def refund_booking_advance(
    booking: dict[str, Any], *, fee: float = 0.0, reason: str = ""
) -> dict[str, Any]:
    """Return a paid advance when a booking is cancelled, less any fee.

    Deliberately never raises into the cancellation that calls it. A booking
    the customer asked to cancel must end up cancelled whether or not Razorpay
    is reachable this second; a refund we could not send becomes a `pending`
    row for operations to retry, not a failed cancellation and a confused
    customer who still has a live trip.

    Returns a short summary of what happened, for the audit trail.
    """
    booking_oid = booking["_id"]

    if booking.get("advance_status") == AdvanceStatus.REFUNDED.value:
        return {"refunded": False, "reason": "already refunded"}
    if booking.get("advance_status") != AdvanceStatus.PAID.value:
        return {"refunded": False, "reason": "no advance was paid"}

    # The advance ledger row tells us how it was paid. A cash or manually
    # recorded advance has no gateway payment to reverse.
    payment = await mongodb.payments().find_one(
        {"booking_id": booking_oid, "kind": "advance", "status": PaymentStatus.PAID.value}
    )
    if not payment:
        return {"refunded": False, "reason": "no advance payment on record"}

    paid = float(payment.get("amount") or 0)
    refundable = round(max(paid - float(fee or 0), 0), 2)
    if refundable <= 0:
        await mongodb.bookings().update_one(
            {"_id": booking_oid},
            {"$set": {"advance_status": AdvanceStatus.REFUNDED.value, "refund_amount": 0.0}},
        )
        return {"refunded": False, "reason": "cancellation fee absorbed the advance"}

    if payment.get("provider") != "razorpay" or not payment.get("provider_reference"):
        # Paid offline. Flag it so somebody actually hands the money back.
        await _record_refund(
            booking, payment, amount=refundable, provider="manual",
            reference=None, status="pending", reason=reason,
        )
        return {"refunded": False, "pending": True, "reason": "offline payment, refund by hand"}

    try:
        refund = await razorpay_service.create_refund(
            payment_id=payment["provider_reference"],
            amount_rupees=refundable,
            notes={"booking": booking.get("booking_id", ""), "reason": reason[:200]},
        )
    except Exception:
        logger.exception("Refund failed for booking %s", booking.get("booking_id"))
        await _record_refund(
            booking, payment, amount=refundable, provider="razorpay",
            reference=None, status="pending", reason=reason,
        )
        return {"refunded": False, "pending": True, "reason": "gateway refund failed, queued"}

    await _record_refund(
        booking, payment, amount=refundable, provider="razorpay",
        reference=refund.get("id"), status="processed", reason=reason,
    )
    return {"refunded": True, "amount": refundable, "reference": refund.get("id")}


async def _record_refund(
    booking: dict[str, Any],
    payment: dict[str, Any],
    *,
    amount: float,
    provider: str,
    reference: str | None,
    status: str,
    reason: str,
) -> None:
    """Write the refund to the ledger and mark the booking.

    A refund is a negative ledger row rather than an edit to the original
    payment: the original really did happen, and an audit that erases it is
    worse than useless.
    """
    now = utcnow()
    await mongodb.payments().insert_one(
        {
            "booking_id": booking["_id"],
            "booking_reference": booking.get("booking_id"),
            "customer_id": booking["customer_id"],
            "amount": -abs(amount),
            "kind": "refund",
            "status": PaymentStatus.REFUNDED.value,
            "method": payment.get("method"),
            "provider": provider,
            "provider_reference": reference,
            "refund_of": payment.get("provider_reference"),
            "refund_state": status,
            "note": reason or "Booking cancelled",
            "created_at": now,
            "updated_at": now,
        }
    )
    # Only call the advance REFUNDED once the money has actually gone back.
    # A queued refund leaves it PAID, because anything reading the booking
    # rather than the ledger would otherwise tell the customer, and the admin,
    # that they have been repaid when nothing has left the account yet.
    await mongodb.bookings().update_one(
        {"_id": booking["_id"]},
        {
            "$set": {
                "advance_status": (
                    AdvanceStatus.REFUNDED.value
                    if status == "processed"
                    else AdvanceStatus.PAID.value
                ),
                "refund_amount": abs(amount),
                "refund_state": status,
                "updated_at": now,
            }
        },
    )


async def pending_refunds() -> list[dict[str, Any]]:
    """Refunds that were queued rather than sent. Operations must clear these."""
    cursor = mongodb.payments().find({"kind": "refund", "refund_state": "pending"})
    return [serialize(doc) async for doc in cursor]


async def retry_refund(payment_oid: ObjectId | str, *, actor_id: ObjectId | str) -> dict[str, Any]:
    """Send a refund that was queued after a failure or an offline payment.

    Retrying replaces the queued row rather than adding a second one, so the
    ledger never shows two refunds for money that went back once.
    """
    oid = _oid(payment_oid)
    queued = await mongodb.payments().find_one(
        {"_id": oid, "kind": "refund", "refund_state": "pending"}
    )
    if not queued:
        raise NotFoundError("No queued refund with that id.")

    booking = await mongodb.bookings().find_one({"_id": queued["booking_id"]})
    if not booking:
        raise NotFoundError("Booking not found.")

    await mongodb.payments().delete_one({"_id": oid})
    result = await refund_booking_advance(
        booking, fee=0.0, reason=queued.get("note") or "Refund retried"
    )
    if not result.get("refunded"):
        # refund_booking_advance has already written a fresh queued row.
        raise ConflictError(result.get("reason") or "The refund could not be sent.")
    return result


async def settle_refund_manually(
    payment_oid: ObjectId | str, *, actor_id: ObjectId | str, note: str | None = None
) -> dict[str, Any]:
    """Mark a queued refund as handed back outside the gateway (cash, transfer).

    The row stays; only its state changes, so the audit still shows that the
    money went back by hand rather than through Razorpay.
    """
    oid = _oid(payment_oid)
    now = utcnow()
    updated = await mongodb.payments().find_one_and_update(
        {"_id": oid, "kind": "refund", "refund_state": "pending"},
        {
            "$set": {
                "refund_state": "settled_manually",
                "settled_by": _oid(actor_id),
                "settled_note": note,
                "updated_at": now,
            }
        },
        return_document=True,
    )
    if not updated:
        raise NotFoundError("No queued refund with that id.")
    await mongodb.bookings().update_one(
        {"_id": updated["booking_id"]},
        {
            "$set": {
                "advance_status": AdvanceStatus.REFUNDED.value,
                "refund_state": "settled_manually",
                "updated_at": now,
            }
        },
    )
    return serialize(updated)


async def stuck_intents() -> list[dict[str, Any]]:
    """Payments taken whose side effect half-failed. Same shape of problem."""
    cursor = mongodb.payment_intents().find({"status": "needs_attention"})
    return [serialize(doc) async for doc in cursor]
