"""Regressions for the bugs a security review found.

Each of these was live. The common thread is that none of the paths they sit
on had a single test: driver cancellation had zero references in the suite,
online balance payments were never exercised end to end, and nothing checked
what an anonymous caller could reach.
"""

from __future__ import annotations

import datetime as dt

import pytest
from bson import ObjectId

from app.core.errors import ConflictError  # noqa: F401
from app.db import mongodb
from app.models.enums import AdvanceStatus, BookingStatus, Role
from app.schemas.common import utcnow
from app.services import booking_service, payment_service, razorpay_service, wallet_service

pytestmark = pytest.mark.asyncio(loop_scope="session")


async def _assigned_trip(customer, *, fare=4000.0, balance=20000.0, minutes_out=30):
    """A trip a driver has accepted, with their deposit behind it."""
    user_id = ObjectId()
    driver_id = (await mongodb.drivers().insert_one({
        "user_id": user_id, "name": "Cancel Driver", "driver_type": "owner",
        "status": "active", "verification_status": "verified",
        "wallet_balance": balance, "wallet_held": 0.0,
    })).inserted_id
    booking_oid = ObjectId()
    await mongodb.bookings().insert_one({
        "_id": booking_oid, "booking_id": f"NM-DC-{str(booking_oid)[-5:]}",
        "customer_id": customer["_id"], "driver_id": driver_id,
        "status": BookingStatus.DRIVER_ASSIGNED.value, "vehicle_type": "sedan",
        "total_fare": fare, "amount_paid": 0.0,
        "passenger_name": "Rider", "passenger_phone": "9876500099", "passenger_count": 1,
        "scheduled_at": utcnow() + dt.timedelta(minutes=minutes_out),
        "created_at": utcnow(), "updated_at": utcnow(),
    })
    driver = await mongodb.drivers().find_one({"_id": driver_id})
    return booking_oid, driver


# ---------------------------------------------------------------------------
# Driver cancellation — charged, then always failed, and was repeatable
# ---------------------------------------------------------------------------


async def test_a_driver_can_actually_cancel(seeded):
    """It charged the penalty and then raised, every single time."""
    booking_oid, driver = await _assigned_trip(seeded["customer"])

    result = await booking_service.driver_cancel(booking_oid, driver, "Car broke down")

    assert result["penalty"]["charged"] is True
    booking = await mongodb.bookings().find_one({"_id": booking_oid})
    # Back to the pool, not cancelled: the customer still wants the trip.
    assert booking["status"] == BookingStatus.CONFIRMED.value
    assert booking["driver_id"] is None


async def test_cancelling_twice_charges_once(seeded):
    """The bug: each failed tap took another full fare out of the deposit."""
    booking_oid, driver = await _assigned_trip(seeded["customer"], fare=4000.0, balance=20000.0)

    await booking_service.driver_cancel(booking_oid, driver, "Car broke down")
    # Refused on the second attempt — the trip is no longer theirs to cancel.
    # Which error matters less than the fact that nothing else is charged.
    with pytest.raises(Exception):
        await booking_service.driver_cancel(booking_oid, driver, "Car broke down")

    after = await mongodb.drivers().find_one({"_id": driver["_id"]})
    assert after["wallet_balance"] == 16000.0  # one ₹4,000 penalty, not two

    charges = await mongodb.wallet_transactions().count_documents(
        {"driver_id": driver["_id"], "type": "penalty"}
    )
    assert charges == 1


# ---------------------------------------------------------------------------
# Online balance payments — taken, then unrefundable
# ---------------------------------------------------------------------------


async def test_a_balance_paid_online_is_recorded_as_a_gateway_payment(seeded):
    """Stamped "manual", it was invisible to both refund paths."""
    from app.schemas.booking import PaymentRecord
    from app.models.enums import PaymentMethod, PaymentStatus

    booking_oid = ObjectId()
    await mongodb.bookings().insert_one({
        "_id": booking_oid, "booking_id": "NM-BAL-0001", "customer_id": seeded["customer"]["_id"],
        "status": BookingStatus.TRIP_STARTED.value, "vehicle_type": "sedan",
        "total_fare": 4000.0, "amount_paid": 0.0, "scheduled_at": utcnow(),
        "created_at": utcnow(), "updated_at": utcnow(),
    })

    await booking_service.record_payment(
        booking_oid,
        PaymentRecord(amount=4000.0, method=PaymentMethod.UPI, status=PaymentStatus.PAID,
                      reference="pay_bal_1", note="Paid online"),
        actor_id=seeded["customer"]["_id"],
        provider="razorpay",
        kind="balance",
    )

    row = await mongodb.payments().find_one({"booking_id": booking_oid})
    assert row["provider"] == "razorpay"
    assert row["kind"] == "balance"


async def test_a_balance_cannot_be_charged_before_the_booking_is_confirmed(seeded):
    """It charged 100% of the fare and left the booking awaiting payment, so
    no driver ever saw it."""
    booking_oid = ObjectId()
    await mongodb.bookings().insert_one({
        "_id": booking_oid, "booking_id": "NM-BAL-0002", "customer_id": seeded["customer"]["_id"],
        "status": BookingStatus.AWAITING_PAYMENT.value, "vehicle_type": "sedan",
        "total_fare": 4000.0, "amount_paid": 0.0, "scheduled_at": utcnow(),
        "created_at": utcnow(), "updated_at": utcnow(),
    })
    user = await mongodb.users().find_one({"_id": seeded["customer"]["_id"]})

    with pytest.raises(ConflictError):
        await payment_service.create_intent(
            user, purpose="balance", booking_id=str(booking_oid)
        )


async def test_concurrent_payments_are_not_lost(seeded):
    """amount_paid was a read-add-write, so the second overwrote the first."""
    import asyncio
    from app.schemas.booking import PaymentRecord
    from app.models.enums import PaymentMethod, PaymentStatus

    booking_oid = ObjectId()
    await mongodb.bookings().insert_one({
        "_id": booking_oid, "booking_id": "NM-RACE-0001", "customer_id": seeded["customer"]["_id"],
        "status": BookingStatus.TRIP_STARTED.value, "vehicle_type": "sedan",
        "total_fare": 4000.0, "amount_paid": 0.0, "scheduled_at": utcnow(),
        "created_at": utcnow(), "updated_at": utcnow(),
    })

    def record(ref):
        return booking_service.record_payment(
            booking_oid,
            PaymentRecord(amount=2000.0, method=PaymentMethod.UPI,
                          status=PaymentStatus.PAID, reference=ref),
            actor_id=seeded["customer"]["_id"], provider="razorpay", kind="balance",
        )

    await asyncio.gather(record("pay_r1"), record("pay_r2"))

    booking = await mongodb.bookings().find_one({"_id": booking_oid})
    assert booking["amount_paid"] == 4000.0


async def test_a_small_refund_does_not_block_the_rest(seeded, monkeypatch):
    """A ₹1 goodwill refund flipped advance_status and stranded ₹599."""
    seq = {"n": 0}

    async def fake_refund(**_):
        # Unique per call: the ledger's unique provider_reference index is real
        # and would reject a repeat, which is the point of it.
        seq["n"] += 1
        return {"id": f"rfnd_partial_{seq['n']}"}

    monkeypatch.setattr(razorpay_service, "create_refund", fake_refund)

    booking_oid = ObjectId()
    await mongodb.bookings().insert_one({
        "_id": booking_oid, "booking_id": "NM-PART-0001", "customer_id": seeded["customer"]["_id"],
        "status": BookingStatus.CONFIRMED.value, "vehicle_type": "sedan",
        "total_fare": 3000.0, "amount_paid": 600.0, "advance_amount": 600.0,
        "advance_status": AdvanceStatus.PAID.value, "scheduled_at": utcnow(),
        "created_at": utcnow(), "updated_at": utcnow(),
    })
    await mongodb.payments().insert_one({
        "booking_id": booking_oid, "customer_id": seeded["customer"]["_id"],
        "amount": 600.0, "kind": "advance", "status": "paid", "provider": "razorpay",
        "provider_reference": "pay_part_1", "created_at": utcnow(), "updated_at": utcnow(),
    })

    await payment_service.refund_payment(
        booking_oid, amount=1.0, reason="goodwill", actor_id=ObjectId()
    )
    booking = await mongodb.bookings().find_one({"_id": booking_oid})
    assert booking["advance_status"] == AdvanceStatus.PAID.value  # not fully refunded

    result = await payment_service.refund_booking_advance(booking, fee=0.0, reason="cancelled")
    assert result["refunded"] is True
    assert result["amount"] == 599.0


# ---------------------------------------------------------------------------
# The unauthenticated surface
# ---------------------------------------------------------------------------


async def test_place_suggestions_never_leak_other_peoples_addresses(client, seeded):
    """`distinct` over every user's saved_locations returned strangers' homes."""
    await mongodb.users().update_one(
        {"_id": seeded["customer"]["_id"]},
        {"$set": {"saved_locations": [{"label": "Home", "address": "Flat 12B, Lotus Residency, Pune"}]}},
    )
    for query in ("Lotus", "4", "Residency"):
        response = await client.get(f"/api/public/places?q={query}")
        assert response.status_code == 200
        assert not any("Lotus Residency" in item["description"] for item in response.json())


@pytest.mark.parametrize("bad", ["(a+)+$", "[", ".*", "\\"])
async def test_a_regex_in_a_place_query_is_harmless(client, seeded, bad):
    """Unescaped, these reached mongod — one of them 500s, one scans the lot."""
    response = await client.get("/api/public/places", params={"q": bad})
    assert response.status_code == 200


async def test_a_booking_cannot_be_read_with_a_letters_only_phone(client, seeded):
    """It normalised to "", which matched every account with no phone stored —
    every Google sign-up and every closed account."""
    created = await client.post("/api/public/bookings", json={
        "name": "Leak Target", "phone": "9833322111",
        "pickup": "Pune", "drop": "Mumbai", "vehicle_type": "sedan",
        "scheduled_at": (utcnow() + dt.timedelta(days=2)).isoformat(),
    })
    reference = created.json()["booking_id"]
    # Blank the stored phone, as a Google sign-up or a closed account would be.
    booking = await mongodb.bookings().find_one({"booking_id": reference})
    await mongodb.users().update_one({"_id": booking["customer_id"]}, {"$set": {"phone": None}})

    for attempt in ("aaaaaaaaaa", "", "----------"):
        response = await client.get(f"/api/public/bookings/{reference}", params={"phone": attempt})
        assert response.status_code in (404, 422), f"{attempt!r} got through"
