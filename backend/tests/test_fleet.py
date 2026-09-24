"""Fleet owners, the security deposit, and the customer advance — end to end.

The gates these pin are the ones that cost real money if they fail: an
unverified or underfunded owner must not be able to take work, an owner must
not be able to touch another owner's fleet, and a booking must not reach a
driver before the customer's advance has actually been received.
"""

from __future__ import annotations

import datetime as dt
import uuid

import pytest

from app.db import mongodb
from app.models.enums import BookingStatus, VerificationStatus
from tests.conftest import auth

pytestmark = pytest.mark.asyncio(loop_scope="session")

PASSWORD = "Password@123"


def _unique(prefix: str) -> str:
    return f"{prefix}-{uuid.uuid4().hex[:8]}@localride-test.com"


def _phone() -> str:
    return f"9{uuid.uuid4().int % 900000000 + 100000000}"


def _booking_payload(route_id: str, days_ahead: int = 3) -> dict:
    scheduled = dt.datetime.now(dt.timezone.utc) + dt.timedelta(days=days_ahead)
    return {
        "route_id": route_id,
        "pickup": {"address": "Baner Road, Pune"},
        "drop": {"address": "Bandra Kurla Complex, Mumbai"},
        "trip_type": "one_way",
        "vehicle_type": "sedan",
        "scheduled_at": scheduled.replace(
            hour=9, minute=0, second=0, microsecond=0
        ).isoformat(),
        "passenger_count": 2,
        "passenger_name": "Test Customer",
        "passenger_phone": "9000000002",
        "payment_method": "cash",
    }


async def _signup_owner(client, **overrides) -> dict:
    payload = {
        "name": "Fleet Owner",
        "email": _unique("owner"),
        "phone": _phone(),
        "password": PASSWORD,
        "licence_number": f"MH12{uuid.uuid4().hex[:8].upper()}",
        "licence_expiry": (dt.date.today() + dt.timedelta(days=900)).isoformat(),
        **overrides,
    }
    response = await client.post("/api/auth/driver-signup", json=payload)
    assert response.status_code == 201, response.text
    return {"token": response.json()["access_token"], "email": payload["email"]}


async def _verify(email: str) -> None:
    """Approve a driver the way an admin would, straight in the database."""
    user = await mongodb.users().find_one({"email": email})
    await mongodb.drivers().update_one(
        {"user_id": user["_id"]},
        {"$set": {"verification_status": VerificationStatus.VERIFIED.value}},
    )


async def _driver_doc(email: str) -> dict:
    user = await mongodb.users().find_one({"email": email})
    return await mongodb.drivers().find_one({"user_id": user["_id"]})


async def _make_confirmed_booking(client, customer_token, admin_token, seeded) -> dict:
    """A booking that has cleared the advance and is waiting for a fleet owner."""
    created = await client.post(
        "/api/bookings",
        headers=auth(customer_token),
        json=_booking_payload(str(seeded["route"]["_id"])),
    )
    assert created.status_code == 201, created.text
    booking = created.json()

    await client.post(
        f"/api/bookings/{booking['id']}/confirm-availability", headers=auth(admin_token)
    )
    paid = await client.post(
        f"/api/bookings/{booking['id']}/advance-paid", headers=auth(admin_token)
    )
    assert paid.status_code == 200, paid.text
    return paid.json()


# ---------------------------------------------------------------------------
# Signup
# ---------------------------------------------------------------------------


async def test_driver_signup_creates_unverified_owner_with_empty_wallet(client, seeded):
    owner = await _signup_owner(client)
    driver = await _driver_doc(owner["email"])

    assert driver["driver_type"] == "owner"
    assert driver["owner_id"] is None
    assert driver["verification_status"] == VerificationStatus.PENDING.value
    assert driver["wallet_balance"] == 0.0


async def test_signup_cannot_self_verify_or_self_fund(client, seeded):
    """`extra="forbid"` must reject smuggled privilege fields outright."""
    response = await client.post(
        "/api/auth/driver-signup",
        json={
            "name": "Sneaky Owner",
            "email": _unique("sneaky"),
            "phone": _phone(),
            "password": PASSWORD,
            "licence_number": "MH12SNEAKY1",
            "licence_expiry": (dt.date.today() + dt.timedelta(days=900)).isoformat(),
            "verification_status": "verified",
            "wallet_balance": 999999,
            "driver_type": "owner",
        },
    )
    assert response.status_code == 422, "privilege fields were not rejected"


async def test_expired_licence_is_refused(client, seeded):
    response = await client.post(
        "/api/auth/driver-signup",
        json={
            "name": "Expired Licence",
            "email": _unique("expired"),
            "phone": _phone(),
            "password": PASSWORD,
            "licence_number": "MH12EXPIRED",
            "licence_expiry": (dt.date.today() - dt.timedelta(days=1)).isoformat(),
        },
    )
    assert response.status_code == 422


# ---------------------------------------------------------------------------
# Fleet isolation
# ---------------------------------------------------------------------------


async def test_owner_cannot_touch_another_owners_driver(client, seeded):
    alice = await _signup_owner(client)
    bob = await _signup_owner(client)

    added = await client.post(
        "/api/fleet/drivers",
        headers=auth(alice["token"]),
        json={
            "name": "Alice's Driver",
            "email": _unique("sub"),
            "phone": _phone(),
            "password": PASSWORD,
            "licence_number": f"MH14{uuid.uuid4().hex[:8].upper()}",
            "licence_expiry": (dt.date.today() + dt.timedelta(days=700)).isoformat(),
        },
    )
    assert added.status_code == 201, added.text
    sub_id = added.json()["id"]

    hijack = await client.patch(
        f"/api/fleet/drivers/{sub_id}/status?active=false", headers=auth(bob["token"])
    )
    assert hijack.status_code == 404, "one owner suspended another owner's driver"


async def test_employed_driver_cannot_manage_a_fleet(client, seeded):
    owner = await _signup_owner(client)
    sub_email = _unique("employee")
    added = await client.post(
        "/api/fleet/drivers",
        headers=auth(owner["token"]),
        json={
            "name": "Employed Driver",
            "email": sub_email,
            "phone": _phone(),
            "password": PASSWORD,
            "licence_number": f"MH15{uuid.uuid4().hex[:8].upper()}",
            "licence_expiry": (dt.date.today() + dt.timedelta(days=700)).isoformat(),
        },
    )
    assert added.status_code == 201

    login = await client.post("/api/auth/login", json={"email": sub_email, "password": PASSWORD})
    sub_token = login.json()["access_token"]

    response = await client.post(
        "/api/fleet/vehicles",
        headers=auth(sub_token),
        json={
            "vehicle_type": "sedan",
            "model": "Not Mine",
            "registration_number": f"MH01{uuid.uuid4().hex[:6].upper()}",
            "seating_capacity": 4,
        },
    )
    assert response.status_code == 403, "an employed driver added a vehicle"


# ---------------------------------------------------------------------------
# The advance gate
# ---------------------------------------------------------------------------


async def test_advance_is_computed_server_side(
    client, customer_token, admin_token, seeded, manual_confirmation
):
    created = await client.post(
        "/api/bookings",
        headers=auth(customer_token),
        json=_booking_payload(str(seeded["route"]["_id"])),
    )
    booking = created.json()
    fare = booking["total_fare"]

    confirmed = await client.post(
        f"/api/bookings/{booking['id']}/confirm-availability", headers=auth(admin_token)
    )
    assert confirmed.status_code == 200, confirmed.text
    body = confirmed.json()

    assert body["status"] == BookingStatus.AWAITING_PAYMENT.value
    assert body["advance_amount"] == pytest.approx(round(fare * 0.15, 2))
    assert body["balance_due"] == pytest.approx(round(fare - body["advance_amount"], 2))


async def test_driver_cannot_be_assigned_before_the_advance_is_paid(
    client, customer_token, admin_token, seeded
):
    created = await client.post(
        "/api/bookings",
        headers=auth(customer_token),
        json=_booking_payload(str(seeded["route"]["_id"])),
    )
    booking_id = created.json()["id"]
    await client.post(
        f"/api/bookings/{booking_id}/confirm-availability", headers=auth(admin_token)
    )

    owner = await _signup_owner(client)
    await _verify(owner["email"])
    driver = await _driver_doc(owner["email"])

    response = await client.post(
        f"/api/bookings/{booking_id}/assign-driver",
        headers=auth(admin_token),
        json={"driver_id": str(driver["_id"])},
    )
    assert response.status_code in (409, 422), "a driver was assigned to an unpaid booking"


# ---------------------------------------------------------------------------
# Accepting work
# ---------------------------------------------------------------------------


async def test_unverified_owner_cannot_accept(client, customer_token, admin_token, seeded):
    booking = await _make_confirmed_booking(client, customer_token, admin_token, seeded)
    owner = await _signup_owner(client)  # deliberately not verified
    driver = await _driver_doc(owner["email"])

    vehicle = await client.post(
        "/api/fleet/vehicles",
        headers=auth(owner["token"]),
        json={
            "vehicle_type": "sedan",
            "model": "Dzire",
            "registration_number": f"MH02{uuid.uuid4().hex[:6].upper()}",
            "seating_capacity": 4,
        },
    )
    response = await client.post(
        f"/api/fleet/open-bookings/{booking['id']}/accept",
        headers=auth(owner["token"]),
        json={"vehicle_id": vehicle.json()["id"], "driver_id": str(driver["_id"])},
    )
    assert response.status_code == 422
    assert "verified" in response.text.lower()


async def test_underfunded_owner_is_refused_and_told_the_shortfall(
    client, customer_token, admin_token, seeded
):
    booking = await _make_confirmed_booking(client, customer_token, admin_token, seeded)
    owner = await _signup_owner(client)
    await _verify(owner["email"])
    driver = await _driver_doc(owner["email"])

    vehicle = await client.post(
        "/api/fleet/vehicles",
        headers=auth(owner["token"]),
        json={
            "vehicle_type": "sedan",
            "model": "Dzire",
            "registration_number": f"MH03{uuid.uuid4().hex[:6].upper()}",
            "seating_capacity": 4,
        },
    )
    response = await client.post(
        f"/api/fleet/open-bookings/{booking['id']}/accept",
        headers=auth(owner["token"]),
        json={"vehicle_id": vehicle.json()["id"], "driver_id": str(driver["_id"])},
    )
    assert response.status_code == 409
    assert "800" in response.text, "should name the minimum balance"


async def test_funded_verified_owner_accepts_and_deposit_is_held(
    client, customer_token, admin_token, seeded
):
    booking = await _make_confirmed_booking(client, customer_token, admin_token, seeded)
    owner = await _signup_owner(client)
    await _verify(owner["email"])
    driver = await _driver_doc(owner["email"])

    topped = await client.post(
        f"/api/drivers/{driver['_id']}/wallet/topup",
        headers=auth(admin_token),
        json={"amount": 5000, "note": "Security deposit"},
    )
    assert topped.status_code == 200, topped.text

    vehicle = await client.post(
        "/api/fleet/vehicles",
        headers=auth(owner["token"]),
        json={
            "vehicle_type": "sedan",
            "model": "Dzire",
            "registration_number": f"MH04{uuid.uuid4().hex[:6].upper()}",
            "seating_capacity": 4,
        },
    )
    accepted = await client.post(
        f"/api/fleet/open-bookings/{booking['id']}/accept",
        headers=auth(owner["token"]),
        json={"vehicle_id": vehicle.json()["id"], "driver_id": str(driver["_id"])},
    )
    assert accepted.status_code == 200, accepted.text
    assert accepted.json()["status"] == BookingStatus.DRIVER_ASSIGNED.value

    wallet = await client.get("/api/fleet/wallet", headers=auth(owner["token"]))
    body = wallet.json()
    assert body["held"] > 0, "accepting a trip did not hold the deposit"
    assert body["available"] == pytest.approx(body["balance"] - body["held"])


async def test_owner_cannot_accept_with_a_vehicle_they_do_not_own(
    client, customer_token, admin_token, seeded
):
    booking = await _make_confirmed_booking(client, customer_token, admin_token, seeded)

    alice = await _signup_owner(client)
    await _verify(alice["email"])
    alice_vehicle = await client.post(
        "/api/fleet/vehicles",
        headers=auth(alice["token"]),
        json={
            "vehicle_type": "sedan",
            "model": "Alice's Car",
            "registration_number": f"MH05{uuid.uuid4().hex[:6].upper()}",
            "seating_capacity": 4,
        },
    )

    bob = await _signup_owner(client)
    await _verify(bob["email"])
    bob_driver = await _driver_doc(bob["email"])
    await client.post(
        f"/api/drivers/{bob_driver['_id']}/wallet/topup",
        headers=auth(admin_token),
        json={"amount": 5000},
    )

    response = await client.post(
        f"/api/fleet/open-bookings/{booking['id']}/accept",
        headers=auth(bob["token"]),
        json={"vehicle_id": alice_vehicle.json()["id"], "driver_id": str(bob_driver["_id"])},
    )
    assert response.status_code == 404, "accepted a trip with someone else's vehicle"


async def test_a_trip_can_only_be_taken_once(client, customer_token, admin_token, seeded):
    booking = await _make_confirmed_booking(client, customer_token, admin_token, seeded)

    owners = []
    for _ in range(2):
        owner = await _signup_owner(client)
        await _verify(owner["email"])
        driver = await _driver_doc(owner["email"])
        await client.post(
            f"/api/drivers/{driver['_id']}/wallet/topup",
            headers=auth(admin_token),
            json={"amount": 5000},
        )
        vehicle = await client.post(
            "/api/fleet/vehicles",
            headers=auth(owner["token"]),
            json={
                "vehicle_type": "sedan",
                "model": "Contender",
                "registration_number": f"MH06{uuid.uuid4().hex[:6].upper()}",
                "seating_capacity": 4,
            },
        )
        owners.append((owner, driver, vehicle.json()["id"]))

    results = []
    for owner, driver, vehicle_id in owners:
        response = await client.post(
            f"/api/fleet/open-bookings/{booking['id']}/accept",
            headers=auth(owner["token"]),
            json={"vehicle_id": vehicle_id, "driver_id": str(driver["_id"])},
        )
        results.append(response.status_code)

    assert results.count(200) == 1, f"trip taken more than once: {results}"

    # The loser must not be left with money tied up in a trip they did not get.
    loser = owners[1][0] if results[0] == 200 else owners[0][0]
    wallet = await client.get("/api/fleet/wallet", headers=auth(loser["token"]))
    assert wallet.json()["held"] == 0, "a failed acceptance stranded a wallet hold"
