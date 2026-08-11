"""Driver wallet: the deposit floor, per-ride holds and ledger integrity.

These pin the behaviour the money depends on. The per-ride *formula* is still
provisional, so the tests assert its shape — bigger fare demands a bigger hold,
floors and ceilings apply — rather than exact rupee amounts that would have to
be rewritten the moment the real rule lands.
"""

from __future__ import annotations

import pytest
from bson import ObjectId

from app.core.errors import ConflictError
from app.db import mongodb
from app.schemas.admin import WalletSettings
from app.services import wallet_service

pytestmark = pytest.mark.asyncio(loop_scope="session")


async def _make_driver(balance: float = 0.0) -> ObjectId:
    result = await mongodb.drivers().insert_one(
        {
            "name": "Wallet Test Driver",
            # `drivers.user_id` is uniquely indexed, so every fixture driver
            # needs a distinct one — several bare docs would all collide on null.
            "user_id": ObjectId(),
            "driver_type": "owner",
            "wallet_balance": balance,
            "wallet_held": 0.0,
        }
    )
    return result.inserted_id


# ---------------------------------------------------------------------------
# The rule
# ---------------------------------------------------------------------------


async def test_required_scales_with_fare():
    settings = WalletSettings(per_ride_percent=10, per_ride_min=0, per_ride_max=0)
    small = wallet_service.required_for_booking({"total_fare": 1000}, settings)
    large = wallet_service.required_for_booking({"total_fare": 5000}, settings)
    assert small == 100
    assert large == 500
    assert large > small


async def test_required_respects_floor_and_ceiling():
    settings = WalletSettings(per_ride_percent=10, per_ride_min=200, per_ride_max=400)
    # 10% of 500 is 50, but the floor lifts it.
    assert wallet_service.required_for_booking({"total_fare": 500}, settings) == 200
    # 10% of 90,000 is 9,000, but the ceiling caps it.
    assert wallet_service.required_for_booking({"total_fare": 90_000}, settings) == 400


# ---------------------------------------------------------------------------
# Ledger
# ---------------------------------------------------------------------------


async def test_credit_and_debit_track_the_ledger(seeded):
    driver_id = await _make_driver()
    await wallet_service.credit(driver_id, 1000, note="Opening deposit")
    await wallet_service.debit(driver_id, 250, note="Withdrawal")

    report = await wallet_service.reconcile(driver_id)
    assert report["stored_balance"] == 750
    assert report["ledger_balance"] == 750
    assert report["balance_matches"] is True


async def test_debit_cannot_overdraw(seeded):
    driver_id = await _make_driver(balance=500)
    with pytest.raises(ConflictError):
        await wallet_service.debit(driver_id, 900)

    # The failed attempt must leave nothing behind.
    report = await wallet_service.reconcile(driver_id)
    assert report["stored_balance"] == 500


async def test_hold_makes_money_unavailable_without_removing_it(seeded):
    driver_id = await _make_driver(balance=1000)
    booking_id = ObjectId()
    await wallet_service.hold(driver_id, booking_id, 400)

    driver = await mongodb.drivers().find_one({"_id": driver_id})
    assert driver["wallet_balance"] == 1000, "a hold must not spend the money"
    assert driver["wallet_held"] == 400

    # Only ₹600 is actually spendable now.
    with pytest.raises(ConflictError):
        await wallet_service.debit(driver_id, 700)


async def test_hold_is_not_stacked_for_the_same_booking(seeded):
    driver_id = await _make_driver(balance=1000)
    booking_id = ObjectId()
    await wallet_service.hold(driver_id, booking_id, 300)
    await wallet_service.hold(driver_id, booking_id, 300)

    driver = await mongodb.drivers().find_one({"_id": driver_id})
    assert driver["wallet_held"] == 300, "re-accepting the same trip double-held"


async def test_release_returns_the_hold_and_is_idempotent(seeded):
    driver_id = await _make_driver(balance=1000)
    booking_id = ObjectId()
    await wallet_service.hold(driver_id, booking_id, 400)
    await wallet_service.release(driver_id, booking_id)
    await wallet_service.release(driver_id, booking_id)  # second call must be a no-op

    driver = await mongodb.drivers().find_one({"_id": driver_id})
    assert driver["wallet_held"] == 0
    assert driver["wallet_balance"] == 1000

    report = await wallet_service.reconcile(driver_id)
    assert report["held_matches"] is True


# ---------------------------------------------------------------------------
# Eligibility
# ---------------------------------------------------------------------------


async def test_driver_below_the_floor_is_refused_and_told_the_shortfall(seeded):
    driver_id = await _make_driver(balance=500)
    driver = await mongodb.drivers().find_one({"_id": driver_id})

    result = await wallet_service.eligibility(driver, {"total_fare": 2000})
    assert result["eligible"] is False
    assert "300" in result["reason"], "should say how much is missing, not just refuse"


async def test_eligible_driver_passes(seeded):
    driver_id = await _make_driver(balance=5000)
    driver = await mongodb.drivers().find_one({"_id": driver_id})

    result = await wallet_service.eligibility(driver, {"total_fare": 2000})
    assert result["eligible"] is True
    assert result["reason"] == ""


async def test_held_funds_do_not_count_towards_the_next_trip(seeded):
    driver_id = await _make_driver(balance=1000)
    await wallet_service.hold(driver_id, ObjectId(), 900)
    driver = await mongodb.drivers().find_one({"_id": driver_id})

    result = await wallet_service.eligibility(driver, {"total_fare": 5000})
    assert result["available"] == 100
    assert result["eligible"] is False, "money already committed to a live trip was reused"
