"""Online payments: signatures, server-derived amounts, and idempotency.

These are the tests that matter most in the codebase. A bug here does not
render a page wrong — it takes someone's money and does not credit it, or
credits it twice. Each one pins a property that must hold no matter how the
gateway behaves or how often it retries.
"""

from __future__ import annotations

import asyncio
import hashlib
import hmac
import json

import pytest
from bson import ObjectId

from app.core.errors import ConflictError, NotFoundError, ValidationError
from app.db import mongodb
from app.models.enums import AdvanceStatus, BookingStatus, Role
from app.schemas.common import utcnow
from app.services import payment_service, razorpay_service

pytestmark = pytest.mark.asyncio(loop_scope="session")

KEY_ID = "rzp_test_fake000000000"
KEY_SECRET = "secret-for-tests-only"
WEBHOOK_SECRET = "webhook-secret-for-tests"


@pytest.fixture(autouse=True)
def razorpay_keys(monkeypatch):
    """Pretend the gateway is configured, without ever calling it."""
    from app.core.config import settings

    monkeypatch.setattr(settings, "RAZORPAY_KEY_ID", KEY_ID, raising=False)
    monkeypatch.setattr(settings, "RAZORPAY_KEY_SECRET", KEY_SECRET, raising=False)
    monkeypatch.setattr(settings, "RAZORPAY_WEBHOOK_SECRET", WEBHOOK_SECRET, raising=False)


def sign(message: bytes, secret: str) -> str:
    return hmac.new(secret.encode(), message, hashlib.sha256).hexdigest()


async def _make_driver(balance: float = 0.0) -> ObjectId:
    result = await mongodb.drivers().insert_one(
        {
            "name": "Payment Test Driver",
            "user_id": ObjectId(),
            "driver_type": "owner",
            "wallet_balance": balance,
            "wallet_held": 0.0,
        }
    )
    return result.inserted_id


async def _make_intent(purpose: str, amount: float, **extra) -> str:
    order_id = f"order_{ObjectId()}"
    await mongodb.payment_intents().insert_one(
        {
            "order_id": order_id,
            "purpose": purpose,
            "status": "created",
            "amount": amount,
            "amount_paise": int(amount * 100),
            "user_id": extra.pop("user_id", ObjectId()),
            "booking_id": extra.pop("booking_id", None),
            "driver_id": extra.pop("driver_id", None),
            "provider": "razorpay",
            "provider_payment_id": None,
            "created_at": utcnow(),
            "updated_at": utcnow(),
            **extra,
        }
    )
    return order_id


# ---------------------------------------------------------------------------
# Signatures
# ---------------------------------------------------------------------------


async def test_checkout_signature_accepts_a_genuine_pair():
    order_id, payment_id = "order_abc", "pay_xyz"
    signature = sign(f"{order_id}|{payment_id}".encode(), KEY_SECRET)
    assert razorpay_service.verify_checkout_signature(
        order_id=order_id, payment_id=payment_id, signature=signature
    )


@pytest.mark.parametrize(
    "order_id,payment_id",
    [("order_abc", "pay_TAMPERED"), ("order_TAMPERED", "pay_xyz")],
)
async def test_checkout_signature_rejects_tampering(order_id, payment_id):
    """A signature is only valid for the exact pair it was issued for."""
    signature = sign(b"order_abc|pay_xyz", KEY_SECRET)
    assert not razorpay_service.verify_checkout_signature(
        order_id=order_id, payment_id=payment_id, signature=signature
    )


async def test_webhook_signature_is_computed_over_raw_bytes():
    """The property that makes webhook verification work at all.

    Re-serialising the parsed JSON produces different bytes — different key
    order, different spacing — so a digest taken over it will not match. This
    is the single most common way a Razorpay integration silently rejects
    every webhook it receives.
    """
    raw = b'{"event":"payment.captured","payload":{"a":1,"b":2}}'
    signature = sign(raw, WEBHOOK_SECRET)

    assert razorpay_service.verify_webhook_signature(raw_body=raw, signature=signature)

    reserialised = json.dumps(json.loads(raw)).encode()
    assert reserialised != raw
    assert not razorpay_service.verify_webhook_signature(
        raw_body=reserialised, signature=signature
    )


async def test_webhook_signature_rejects_an_unsigned_body():
    assert not razorpay_service.verify_webhook_signature(raw_body=b"{}", signature="")


# ---------------------------------------------------------------------------
# Idempotency
# ---------------------------------------------------------------------------


async def test_replayed_webhook_credits_a_wallet_only_once(seeded):
    """Razorpay retries until it gets a 2xx. The second delivery must be inert."""
    driver_id = await _make_driver(balance=0.0)
    order_id = await _make_intent("wallet_topup", 1000.0, driver_id=driver_id)

    first = await payment_service.apply_payment(
        order_id=order_id, payment_id="pay_1", source="webhook"
    )
    second = await payment_service.apply_payment(
        order_id=order_id, payment_id="pay_1", source="webhook"
    )

    assert first["applied"] is True
    assert second["applied"] is False

    driver = await mongodb.drivers().find_one({"_id": driver_id})
    assert driver["wallet_balance"] == 1000.0


async def test_checkout_and_webhook_racing_apply_once(seeded):
    """Both paths routinely fire for the same payment, sometimes together."""
    driver_id = await _make_driver(balance=0.0)
    order_id = await _make_intent("wallet_topup", 750.0, driver_id=driver_id)

    results = await asyncio.gather(
        payment_service.apply_payment(order_id=order_id, payment_id="pay_2", source="checkout"),
        payment_service.apply_payment(order_id=order_id, payment_id="pay_2", source="webhook"),
    )

    assert sorted(r["applied"] for r in results) == [False, True]
    driver = await mongodb.drivers().find_one({"_id": driver_id})
    assert driver["wallet_balance"] == 750.0


async def test_unknown_order_is_never_credited(seeded):
    """A signed payment for an order we never opened must not invent money."""
    with pytest.raises(NotFoundError):
        await payment_service.apply_payment(
            order_id="order_never_created", payment_id="pay_3", source="webhook"
        )


async def test_ledger_rejects_a_duplicate_provider_reference(seeded):
    """Defence in depth: the database refuses a second row for one payment."""
    from pymongo.errors import DuplicateKeyError

    row = {
        "booking_id": ObjectId(),
        "customer_id": ObjectId(),
        "amount": 500.0,
        "provider": "razorpay",
        "provider_reference": "pay_duplicate_guard",
        "created_at": utcnow(),
        "updated_at": utcnow(),
    }
    await mongodb.payments().insert_one(dict(row))
    with pytest.raises(DuplicateKeyError):
        await mongodb.payments().insert_one(dict(row))


# ---------------------------------------------------------------------------
# The amount is ours, never the client's
# ---------------------------------------------------------------------------


async def test_order_endpoint_rejects_a_client_supplied_fare(client, customer_token):
    """`extra="forbid"` means a smuggled price is a 422, not a silent ignore."""
    from tests.conftest import auth

    response = await client.post(
        "/api/payments/razorpay/order",
        headers=auth(customer_token),
        json={"purpose": "advance", "booking_id": str(ObjectId()), "total_fare": 1.0},
    )
    assert response.status_code == 422


@pytest.mark.parametrize("amount", [1.0, 99.0, 500_000.0])
async def test_wallet_topup_amount_is_range_checked(amount, seeded):
    """The one amount a user picks is still bounded at both ends."""
    user = {"_id": ObjectId(), "role": Role.DRIVER.value}
    with pytest.raises((ValidationError, NotFoundError)):
        await payment_service.create_intent(user, purpose="wallet_topup", amount=amount)


async def test_unknown_purpose_is_refused(seeded):
    user = {"_id": ObjectId(), "role": Role.CUSTOMER.value}
    with pytest.raises(ValidationError):
        await payment_service.create_intent(user, purpose="free_money", amount=10.0)


# ---------------------------------------------------------------------------
# Advance payment end to end
# ---------------------------------------------------------------------------


async def test_paid_advance_confirms_the_booking(seeded):
    customer = seeded["customer"]
    booking_oid = ObjectId()
    await mongodb.bookings().insert_one(
        {
            "_id": booking_oid,
            "booking_id": "LR-TEST-0001",
            "customer_id": customer["_id"],
            "status": BookingStatus.AWAITING_PAYMENT.value,
            "vehicle_type": "sedan",
            "total_fare": 3000.0,
            "amount_paid": 0.0,
            "advance_amount": 450.0,
            "advance_status": AdvanceStatus.PENDING.value,
            "created_at": utcnow(),
            "updated_at": utcnow(),
        }
    )
    order_id = await _make_intent(
        "advance", 450.0, booking_id=booking_oid, user_id=customer["_id"]
    )

    result = await payment_service.apply_payment(
        order_id=order_id, payment_id="pay_advance_1", source="webhook"
    )
    assert result["applied"] is True

    booking = await mongodb.bookings().find_one({"_id": booking_oid})
    assert booking["status"] == BookingStatus.CONFIRMED.value
    assert booking["advance_status"] == AdvanceStatus.PAID.value


async def test_advance_cannot_be_paid_twice(seeded):
    """Two orders for one advance must not both confirm and both charge."""
    customer = seeded["customer"]
    booking_oid = ObjectId()
    await mongodb.bookings().insert_one(
        {
            "_id": booking_oid,
            "booking_id": "LR-TEST-0002",
            "customer_id": customer["_id"],
            "status": BookingStatus.AWAITING_PAYMENT.value,
            "vehicle_type": "sedan",
            "total_fare": 2000.0,
            "amount_paid": 0.0,
            "advance_amount": 300.0,
            "advance_status": AdvanceStatus.PENDING.value,
            "created_at": utcnow(),
            "updated_at": utcnow(),
        }
    )
    first = await _make_intent("advance", 300.0, booking_id=booking_oid, user_id=customer["_id"])
    second = await _make_intent("advance", 300.0, booking_id=booking_oid, user_id=customer["_id"])

    await payment_service.apply_payment(order_id=first, payment_id="pay_a1", source="webhook")

    # The booking has left AWAITING_PAYMENT, so the second order cannot apply.
    with pytest.raises(ConflictError):
        await payment_service.apply_payment(order_id=second, payment_id="pay_a2", source="webhook")


# ---------------------------------------------------------------------------
# Refunds
# ---------------------------------------------------------------------------


async def _cancellable_booking(customer, *, advance_paid=450.0, provider="razorpay"):
    booking_oid = ObjectId()
    await mongodb.bookings().insert_one(
        {
            "_id": booking_oid,
            "booking_id": f"LR-REF-{str(booking_oid)[-4:]}",
            "customer_id": customer["_id"],
            "status": BookingStatus.CONFIRMED.value,
            "vehicle_type": "sedan",
            "total_fare": 3000.0,
            "amount_paid": advance_paid,
            "advance_amount": advance_paid,
            "advance_status": AdvanceStatus.PAID.value,
            "created_at": utcnow(),
            "updated_at": utcnow(),
        }
    )
    await mongodb.payments().insert_one(
        {
            "booking_id": booking_oid,
            "customer_id": customer["_id"],
            "amount": advance_paid,
            "kind": "advance",
            "status": "paid",
            "provider": provider,
            "provider_reference": f"pay_ref_{ObjectId()}" if provider == "razorpay" else None,
            "created_at": utcnow(),
            "updated_at": utcnow(),
        }
    )
    return await mongodb.bookings().find_one({"_id": booking_oid})


async def test_refund_returns_the_advance_less_the_fee(seeded, monkeypatch):
    """A cancellation fee comes out of the refund, not on top of it."""
    sent = {}

    async def fake_refund(*, payment_id, amount_rupees, notes=None):
        sent.update(payment_id=payment_id, amount=amount_rupees)
        return {"id": "rfnd_test_1"}

    monkeypatch.setattr(razorpay_service, "create_refund", fake_refund)
    booking = await _cancellable_booking(seeded["customer"], advance_paid=450.0)

    result = await payment_service.refund_booking_advance(booking, fee=100.0, reason="changed plans")

    assert result["refunded"] is True
    assert sent["amount"] == 350.0
    updated = await mongodb.bookings().find_one({"_id": booking["_id"]})
    assert updated["advance_status"] == AdvanceStatus.REFUNDED.value


async def test_refund_is_written_as_a_negative_ledger_row(seeded, monkeypatch):
    """The original payment stays; the refund is its own row."""

    async def fake_refund(**_):
        return {"id": "rfnd_test_2"}

    monkeypatch.setattr(razorpay_service, "create_refund", fake_refund)
    booking = await _cancellable_booking(seeded["customer"], advance_paid=600.0)

    await payment_service.refund_booking_advance(booking, fee=0.0, reason="cancelled")

    rows = [doc async for doc in mongodb.payments().find({"booking_id": booking["_id"]})]
    kinds = {row["kind"]: row["amount"] for row in rows}
    assert kinds["advance"] == 600.0
    assert kinds["refund"] == -600.0


async def test_a_gateway_failure_queues_the_refund_instead_of_losing_it(seeded, monkeypatch):
    """Razorpay being down must never strand a cancellation."""

    async def boom(**_):
        raise RuntimeError("gateway unavailable")

    monkeypatch.setattr(razorpay_service, "create_refund", boom)
    booking = await _cancellable_booking(seeded["customer"], advance_paid=500.0)

    result = await payment_service.refund_booking_advance(booking, fee=0.0, reason="cancelled")

    assert result["refunded"] is False
    assert result["pending"] is True
    pending = await payment_service.pending_refunds()
    assert any(row["booking_id"] == str(booking["_id"]) for row in pending)


async def test_an_offline_advance_is_flagged_for_manual_return(seeded):
    """Cash in, cash out — but somebody has to be told."""
    booking = await _cancellable_booking(seeded["customer"], advance_paid=400.0, provider="manual")

    result = await payment_service.refund_booking_advance(booking, fee=0.0, reason="cancelled")

    assert result["refunded"] is False
    assert result["pending"] is True


async def test_a_fee_larger_than_the_advance_refunds_nothing(seeded):
    """Never refund a negative amount, and never charge extra either."""
    booking = await _cancellable_booking(seeded["customer"], advance_paid=200.0)

    result = await payment_service.refund_booking_advance(booking, fee=500.0, reason="late cancel")

    assert result["refunded"] is False
    updated = await mongodb.bookings().find_one({"_id": booking["_id"]})
    assert updated["refund_amount"] == 0.0


async def test_an_unpaid_booking_is_not_refunded(seeded):
    booking_oid = ObjectId()
    await mongodb.bookings().insert_one(
        {
            "_id": booking_oid,
            "booking_id": "LR-REF-NONE",
            "customer_id": seeded["customer"]["_id"],
            "status": BookingStatus.REQUESTED.value,
            "vehicle_type": "sedan",
            "total_fare": 1000.0,
            "amount_paid": 0.0,
            "advance_status": AdvanceStatus.PENDING.value,
            "created_at": utcnow(),
            "updated_at": utcnow(),
        }
    )
    booking = await mongodb.bookings().find_one({"_id": booking_oid})
    result = await payment_service.refund_booking_advance(booking, fee=0.0, reason="cancelled")
    assert result["refunded"] is False
