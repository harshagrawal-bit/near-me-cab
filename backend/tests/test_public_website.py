"""The no-login website endpoints.

These are the only routes in the API that anyone on the internet can reach
without an account, so the tests focus on what that changes: a caller cannot
name a price, cannot read someone else's trip, and cannot reach anything that
moves money.
"""

from __future__ import annotations

import datetime as dt

import pytest

from app.db import mongodb

pytestmark = pytest.mark.asyncio(loop_scope="session")


def _when(days: int = 3) -> str:
    return (dt.datetime.now(dt.timezone.utc) + dt.timedelta(days=days)).isoformat()


def _payload(**overrides) -> dict:
    base = {
        "name": "Website Guest",
        "phone": "9812345678",
        "pickup": "Pune",
        "drop": "Mumbai",
        "vehicle_type": "sedan",
        "scheduled_at": _when(),
        "passenger_count": 2,
    }
    base.update(overrides)
    return base


# ---------------------------------------------------------------------------
# Reachable without a login
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("path", ["/api/public/company", "/api/public/routes", "/api/public/vehicle-classes"])
async def test_the_website_can_read_these_without_an_account(client, seeded, path):
    response = await client.get(path)
    assert response.status_code == 200, response.text


async def test_a_quote_needs_no_account(client, seeded):
    response = await client.post(
        "/api/public/quote", json={"pickup": "Pune", "drop": "Mumbai", "trip_type": "one_way"}
    )
    assert response.status_code == 200, response.text
    assert response.json()["options"]


# ---------------------------------------------------------------------------
# Booking
# ---------------------------------------------------------------------------


async def test_a_guest_booking_lands_in_the_same_database(client, seeded):
    """The whole point: one inbox, not two."""
    response = await client.post("/api/public/bookings", json=_payload())
    assert response.status_code == 201, response.text
    reference = response.json()["booking_id"]

    stored = await mongodb.bookings().find_one({"booking_id": reference})
    assert stored is not None
    assert stored["customer_id"] is not None


async def test_a_repeat_caller_is_the_same_customer(client, seeded):
    """Otherwise a regular becomes a dozen strangers in the office's view."""
    phone = "9812300007"
    first = await client.post("/api/public/bookings", json=_payload(phone=phone))
    second = await client.post("/api/public/bookings", json=_payload(phone=phone, name="Same Person"))
    assert first.status_code == 201 and second.status_code == 201

    matches = await mongodb.users().count_documents({"phone": phone})
    assert matches == 1


async def test_a_guest_account_cannot_be_signed_into(client, seeded):
    """It exists to own a booking, not to be a back door."""
    phone = "9812300008"
    await client.post("/api/public/bookings", json=_payload(phone=phone))

    user = await mongodb.users().find_one({"phone": phone})
    assert user["password_hash"] == "!website"

    attempt = await client.post(
        "/api/auth/login", json={"email": user["email"], "password": "!website"}
    )
    # Refused either way: the placeholder hash never matches, and the
    # guest.invalid address is not a deliverable one to begin with.
    assert attempt.status_code in (401, 422)


@pytest.mark.parametrize(
    "bad",
    [
        {"total_fare": 1},        # naming a price
        {"status": "completed"},  # naming a status
        {"payment_option": "pay_later"},
    ],
)
async def test_a_caller_cannot_smuggle_fields(client, seeded, bad):
    """extra='forbid' matters most where nothing is authenticated."""
    response = await client.post("/api/public/bookings", json=_payload(**bad))
    assert response.status_code == 422


@pytest.mark.parametrize("phone", ["12345", "0000000000", "abcdefghij"])
async def test_a_bad_phone_is_refused(client, seeded, phone):
    response = await client.post("/api/public/bookings", json=_payload(phone=phone))
    assert response.status_code == 422


# ---------------------------------------------------------------------------
# Tracking
# ---------------------------------------------------------------------------


async def test_a_booking_can_be_checked_with_the_reference_and_phone(client, seeded):
    phone = "9812300009"
    created = await client.post("/api/public/bookings", json=_payload(phone=phone))
    reference = created.json()["booking_id"]

    response = await client.get(f"/api/public/bookings/{reference}?phone={phone}")
    assert response.status_code == 200
    assert response.json()["booking_id"] == reference


async def test_the_wrong_phone_cannot_read_someone_elses_trip(client, seeded):
    """Without this, sequential references are a directory of other people."""
    created = await client.post("/api/public/bookings", json=_payload(phone="9812300010"))
    reference = created.json()["booking_id"]

    response = await client.get(f"/api/public/bookings/{reference}?phone=9999999999")
    assert response.status_code == 404
    # Same message as an unknown reference, so a wrong phone does not confirm
    # that the reference exists.
    assert "No booking with that reference" in response.text


async def test_an_unknown_reference_is_a_plain_404(client, seeded):
    response = await client.get("/api/public/bookings/NM-NOPE-0001?phone=9812300011")
    assert response.status_code == 404
