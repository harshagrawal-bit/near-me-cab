"""Driver penalties, customer cancellation refunds, payment options, masking.

Each of these decides who is out of pocket when something goes wrong, so the
tests pin the money rather than the plumbing.
"""

from __future__ import annotations

import datetime as dt

import pytest
import pytest_asyncio
from bson import ObjectId

from app.db import mongodb
from app.models.enums import AdvanceStatus, BookingStatus, Role, WalletTxnType
from app.schemas.admin import AdvanceSettings, CancellationSettings, PaymentOptionSettings
from app.schemas.common import utcnow
from app.services import booking_service, settings_service, wallet_service

pytestmark = pytest.mark.asyncio(loop_scope="session")

RULES = CancellationSettings()


@pytest_asyncio.fixture(autouse=True, loop_scope="session")
async def restore_settings(seeded):
    before = await mongodb.admin_settings().find_one({"key": settings_service.SETTINGS_KEY})
    yield
    if before is not None:
        await mongodb.admin_settings().replace_one(
            {"key": settings_service.SETTINGS_KEY}, before
        )


# ---------------------------------------------------------------------------
# Driver cancellation penalties
# ---------------------------------------------------------------------------


def test_dropping_a_trip_near_pickup_costs_the_most():
    """The band that actually strands a customer is the expensive one."""
    now = utcnow()
    critical = wallet_service.penalty_for_cancellation(
        accepted_at=now - dt.timedelta(hours=5),
        scheduled_at=now + dt.timedelta(minutes=30),
        settings=RULES,
        now=now,
    )
    late = wallet_service.penalty_for_cancellation(
        accepted_at=now - dt.timedelta(hours=5),
        scheduled_at=now + dt.timedelta(days=2),
        settings=RULES,
        now=now,
    )
    assert critical["band"] == "critical"
    assert critical["amount"] > late["amount"]


def test_an_immediate_change_of_mind_is_the_cheapest_band():
    now = utcnow()
    grace = wallet_service.penalty_for_cancellation(
        accepted_at=now - dt.timedelta(minutes=5),
        scheduled_at=now + dt.timedelta(days=3),
        settings=RULES,
        now=now,
    )
    assert grace["band"] == "grace"
    assert grace["amount"] == RULES.driver_grace_penalty


def test_proximity_to_pickup_beats_the_grace_window():
    """Accepting and dropping seconds later is still critical if pickup is now."""
    now = utcnow()
    result = wallet_service.penalty_for_cancellation(
        accepted_at=now - dt.timedelta(minutes=1),
        scheduled_at=now + dt.timedelta(minutes=20),
        settings=RULES,
        now=now,
    )
    assert result["band"] == "critical"


async def test_a_penalty_leaves_the_ledger_and_balance_in_step(seeded):
    driver_id = (await mongodb.drivers().insert_one({
        "name": "Penalty Driver", "user_id": ObjectId(), "driver_type": "owner",
        "wallet_balance": 1000.0, "wallet_held": 0.0,
    })).inserted_id

    await wallet_service.charge_penalty(driver_id, 300.0, reason="Cancelled late")

    driver = await mongodb.drivers().find_one({"_id": driver_id})
    assert driver["wallet_balance"] == 700.0
    txn = await mongodb.wallet_transactions().find_one(
        {"driver_id": driver_id, "type": WalletTxnType.PENALTY.value}
    )
    assert txn["amount"] == -300.0


async def test_a_penalty_may_push_a_driver_below_the_floor(seeded):
    """That is the point — they should be blocked until they top up."""
    driver_id = (await mongodb.drivers().insert_one({
        "name": "Broke Driver", "user_id": ObjectId(), "driver_type": "owner",
        "wallet_balance": 200.0, "wallet_held": 0.0,
    })).inserted_id

    await wallet_service.charge_penalty(driver_id, 500.0, reason="Cancelled at pickup")

    driver = await mongodb.drivers().find_one({"_id": driver_id})
    assert driver["wallet_balance"] == -300.0
    verdict = await wallet_service.eligibility(driver)
    assert verdict["eligible"] is False


# ---------------------------------------------------------------------------
# Payment options
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "option,expected_now,expected_due",
    [("pay_later", 0.0, 10000.0), ("full", 10000.0, 0.0), ("part", 1500.0, 8500.0)],
)
def test_each_option_asks_for_the_right_amount(option, expected_now, expected_due):
    result = booking_service.upfront_for_option(
        10000.0,
        option,
        advance_settings=AdvanceSettings(percent=15),
        option_settings=PaymentOptionSettings(),
    )
    assert result["amount"] == expected_now
    assert result["balance_due"] == expected_due


def test_a_part_payment_is_exactly_the_advance():
    """One rule, not two — the thing the collapsed setting guarantees."""
    advance = AdvanceSettings(percent=20, min_amount=500)
    part = booking_service.upfront_for_option(
        4000.0, "part", advance_settings=advance, option_settings=PaymentOptionSettings()
    )
    assert part["amount"] == booking_service.compute_advance(4000.0, advance)["amount"]


def test_a_disabled_option_is_not_honoured_silently():
    """Switching pay-later off must not let a client still choose it."""
    result = booking_service.upfront_for_option(
        5000.0,
        "pay_later",
        advance_settings=AdvanceSettings(percent=10),
        option_settings=PaymentOptionSettings(allow_pay_later=False),
    )
    assert result["option"] == "part"
    assert result["amount"] > 0


def test_an_unknown_option_falls_back_rather_than_charging_zero():
    result = booking_service.upfront_for_option(
        5000.0,
        "free_ride_please",
        advance_settings=AdvanceSettings(percent=10),
        option_settings=PaymentOptionSettings(),
    )
    assert result["amount"] > 0


# ---------------------------------------------------------------------------
# Customer phone masking
# ---------------------------------------------------------------------------


def _mask(hours_out, role, status=BookingStatus.DRIVER_ASSIGNED.value):
    customer = {"_id": ObjectId(), "name": "A", "phone": "9876543210", "email": "a@b.c"}
    booking = {"scheduled_at": utcnow() + dt.timedelta(hours=hours_out), "status": status}
    return booking_service._visible_customer(customer, booking, role, hours_before=2)


def test_a_driver_sees_only_a_masked_number_until_pickup_is_close():
    masked = _mask(10, Role.DRIVER.value)
    assert masked["phone"] == "987654XXXX"
    assert masked["phone_visible"] is False
    assert "email" not in masked


def test_the_number_is_released_two_hours_before_pickup():
    assert _mask(1, Role.DRIVER.value)["phone"] == "9876543210"


def test_a_trip_under_way_always_shows_the_number():
    visible = _mask(48, Role.DRIVER.value, status=BookingStatus.DRIVER_ARRIVING.value)
    assert visible["phone"] == "9876543210"


@pytest.mark.parametrize("role", [Role.ADMIN.value, Role.CUSTOMER.value, None])
def test_only_the_driver_view_is_masked(role):
    assert _mask(72, role)["phone"] == "9876543210"


# ---------------------------------------------------------------------------
# Bank details
# ---------------------------------------------------------------------------


def test_only_the_last_four_digits_of_an_account_are_returned():
    masked = wallet_service.mask_bank_details(
        {"account_name": "S Kulkarni", "account_number": "123456789012", "ifsc": "HDFC0001234"}
    )
    assert masked["account_number_masked"] == "••••9012"
    assert "account_number" not in masked
