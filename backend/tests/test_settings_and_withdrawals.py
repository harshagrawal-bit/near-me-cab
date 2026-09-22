"""Admin-editable settings, and driver withdrawals.

Two things these pin that are easy to get wrong and expensive to get wrong:
a partial settings save must not wipe the fields it did not mention, and a
driver must never be able to withdraw money that is held against a live trip.
"""

from __future__ import annotations

import pytest
import pytest_asyncio
from bson import ObjectId

from app.core.errors import ConflictError, ValidationError
from app.db import mongodb
from app.schemas.admin import AdvanceSettings, SettingsUpdate, WalletSettings
from app.services import settings_service, wallet_service

pytestmark = pytest.mark.asyncio(loop_scope="session")


@pytest_asyncio.fixture(autouse=True, loop_scope="session")
async def restore_settings(seeded):
    """Settings are one shared document, so a test that changes them would
    otherwise silently retune every later test that reads them."""
    before = await mongodb.admin_settings().find_one({"key": settings_service.SETTINGS_KEY})
    yield
    if before is not None:
        await mongodb.admin_settings().replace_one(
            {"key": settings_service.SETTINGS_KEY}, before
        )


async def _driver(balance: float = 0.0, held: float = 0.0) -> ObjectId:
    result = await mongodb.drivers().insert_one(
        {
            "name": "Withdrawal Test Driver",
            "user_id": ObjectId(),
            "driver_type": "owner",
            "wallet_balance": balance,
            "wallet_held": held,
        }
    )
    return result.inserted_id


# ---------------------------------------------------------------------------
# Settings
# ---------------------------------------------------------------------------


async def test_saving_one_field_does_not_reset_the_others(seeded):
    """The bug this guards: every section field has a default, so a naive
    model_dump of a partial update silently restores all of them."""
    await settings_service.update_settings(
        SettingsUpdate(wallet=WalletSettings(min_balance=800, per_ride_percent=10, per_ride_min=200))
    )

    await settings_service.update_settings(
        SettingsUpdate.model_validate({"wallet": {"min_balance": 2500}})
    )

    saved = (await settings_service.get_settings()).wallet
    assert saved.min_balance == 2500
    assert saved.per_ride_percent == 10   # would be back to the default without the fix
    assert saved.per_ride_min == 200


async def test_advance_change_takes_effect_without_a_restart(seeded):
    from app.services.booking_service import compute_advance

    await settings_service.update_settings(
        SettingsUpdate.model_validate({"advance": {"percent": 25}})
    )
    advance = (await settings_service.get_settings()).advance
    assert compute_advance(1000.0, advance)["amount"] == 250.0

    await settings_service.update_settings(
        SettingsUpdate.model_validate({"advance": {"percent": 10}})
    )
    advance = (await settings_service.get_settings()).advance
    assert compute_advance(1000.0, advance)["amount"] == 100.0


@pytest.mark.parametrize(
    "payload",
    [
        {"min_balance": -1},
        {"min_balance": 10_000_000},      # a typo that would block every driver
        {"per_ride_min": 500, "per_ride_max": 200},  # inverted pair
    ],
)
async def test_wallet_settings_reject_dangerous_values(payload):
    with pytest.raises(Exception):
        WalletSettings(**payload)


@pytest.mark.parametrize(
    "payload",
    [{"percent": 150}, {"percent": -5}, {"min_amount": 5000, "max_amount": 1000}],
)
async def test_advance_settings_reject_dangerous_values(payload):
    with pytest.raises(Exception):
        AdvanceSettings(**payload)


# ---------------------------------------------------------------------------
# Withdrawals
# ---------------------------------------------------------------------------


async def test_held_money_cannot_be_withdrawn(seeded):
    """₹1000 balance with ₹400 held against a live trip leaves ₹600."""
    driver_id = await _driver(balance=1000.0, held=400.0)

    with pytest.raises(ValidationError):
        await wallet_service.request_withdrawal(driver_id, 700.0)

    request = await wallet_service.request_withdrawal(driver_id, 600.0)
    assert request["status"] == "pending"


async def test_only_one_open_request_at_a_time(seeded):
    driver_id = await _driver(balance=5000.0)
    await wallet_service.request_withdrawal(driver_id, 1000.0)
    with pytest.raises(ConflictError):
        await wallet_service.request_withdrawal(driver_id, 1000.0)


async def test_requesting_does_not_move_money(seeded):
    """Only approval debits — the money has not left the bank yet."""
    driver_id = await _driver(balance=3000.0)
    await wallet_service.request_withdrawal(driver_id, 1200.0)
    driver = await mongodb.drivers().find_one({"_id": driver_id})
    assert driver["wallet_balance"] == 3000.0


async def test_approval_debits_the_wallet_once(seeded):
    driver_id = await _driver(balance=3000.0)
    request = await wallet_service.request_withdrawal(driver_id, 1200.0)

    await wallet_service.approve_withdrawal(request["id"], actor_id=ObjectId(), reference="NEFT-1")

    driver = await mongodb.drivers().find_one({"_id": driver_id})
    assert driver["wallet_balance"] == 1800.0

    # A second approval of the same request must not debit again.
    with pytest.raises(Exception):
        await wallet_service.approve_withdrawal(request["id"], actor_id=ObjectId())
    driver = await mongodb.drivers().find_one({"_id": driver_id})
    assert driver["wallet_balance"] == 1800.0


async def test_a_hold_placed_after_the_request_blocks_approval(seeded):
    """Availability is re-checked at approval, not trusted from request time."""
    driver_id = await _driver(balance=1000.0)
    request = await wallet_service.request_withdrawal(driver_id, 900.0)

    await wallet_service.hold(driver_id, ObjectId(), 500.0)

    with pytest.raises(ConflictError):
        await wallet_service.approve_withdrawal(request["id"], actor_id=ObjectId())


async def test_rejection_leaves_the_balance_alone(seeded):
    driver_id = await _driver(balance=2000.0)
    request = await wallet_service.request_withdrawal(driver_id, 500.0)

    rejected = await wallet_service.reject_withdrawal(
        request["id"], actor_id=ObjectId(), reason="Documents pending"
    )

    assert rejected["status"] == "rejected"
    driver = await mongodb.drivers().find_one({"_id": driver_id})
    assert driver["wallet_balance"] == 2000.0
