"""Booking creation, price integrity and the status machine."""

from __future__ import annotations

import datetime as dt

import pytest

from app.services.booking_service import BOOKING_PREFIX
from tests.conftest import auth

pytestmark = pytest.mark.asyncio(loop_scope="session")


def booking_payload(route_id: str, **overrides) -> dict:
    scheduled = dt.datetime.now(dt.timezone.utc) + dt.timedelta(days=2)
    payload = {
        "route_id": route_id,
        "pickup": {"address": "Baner Road, Pune"},
        "drop": {"address": "Bandra Kurla Complex, Mumbai"},
        "trip_type": "one_way",
        "vehicle_type": "sedan",
        "scheduled_at": scheduled.replace(hour=9, minute=0, second=0, microsecond=0).isoformat(),
        "passenger_count": 2,
        "passenger_name": "Test Customer",
        "passenger_phone": "9000000002",
        "payment_method": "cash",
    }
    payload.update(overrides)
    return payload


async def test_quote_comes_from_the_price_book(client, customer_token, seeded):
    response = await client.post(
        "/api/pricing/quote",
        json={"route_id": str(seeded["route"]["_id"]), "trip_type": "one_way"},
        headers=auth(customer_token),
    )
    assert response.status_code == 200
    options = {o["vehicle_type"]: o["fare"] for o in response.json()["options"]}
    assert options["sedan"] == 3000
    assert options["suv"] == 4000


async def test_booking_uses_server_price(client, customer_token, seeded, manual_confirmation):
    response = await client.post(
        "/api/bookings",
        json=booking_payload(str(seeded["route"]["_id"])),
        headers=auth(customer_token),
    )
    assert response.status_code == 201, response.text
    booking = response.json()
    assert booking["total_fare"] == 3000
    assert booking["status"] == "requested"
    # Reference the constant, not a literal — the prefix is brand-dependent
    # and configurable, so hard-coding it here breaks on every rebrand.
    assert booking["booking_id"].startswith(f"{BOOKING_PREFIX}-")


@pytest.mark.parametrize("field", ["total_fare", "fare", "price", "quoted_fare", "discount"])
async def test_client_supplied_price_is_rejected(client, customer_token, seeded, field):
    """The client must not be able to name its own price, at any key."""
    payload = booking_payload(str(seeded["route"]["_id"]))
    payload[field] = 1
    response = await client.post("/api/bookings", json=payload, headers=auth(customer_token))
    assert response.status_code == 422, f"'{field}' was accepted from the client"


async def test_role_cannot_be_injected_into_a_booking(client, customer_token, seeded):
    payload = booking_payload(str(seeded["route"]["_id"]))
    payload["customer_id"] = "000000000000000000000000"
    response = await client.post("/api/bookings", json=payload, headers=auth(customer_token))
    assert response.status_code == 422


async def test_passenger_count_validated_against_vehicle_class(client, customer_token, seeded):
    payload = booking_payload(str(seeded["route"]["_id"]), passenger_count=6)
    response = await client.post("/api/bookings", json=payload, headers=auth(customer_token))
    assert response.status_code == 422


async def test_past_pickup_rejected(client, customer_token, seeded):
    past = (dt.datetime.now(dt.timezone.utc) - dt.timedelta(days=1)).isoformat()
    payload = booking_payload(str(seeded["route"]["_id"]), scheduled_at=past)
    response = await client.post("/api/bookings", json=payload, headers=auth(customer_token))
    assert response.status_code == 422


async def test_customer_only_sees_own_bookings(client, customer_token, admin_token, seeded):
    created = await client.post(
        "/api/bookings",
        json=booking_payload(str(seeded["route"]["_id"])),
        headers=auth(customer_token),
    )
    booking_id = created.json()["id"]

    # A second customer must not be able to read it.
    await client.post(
        "/api/auth/register",
        json={
            "name": "Other Customer",
            "email": "other@localride-test.com",
            "phone": "9000000199",
            "password": "Str0ng@pass",
        },
    )
    other = await client.post(
        "/api/auth/login", json={"email": "other@localride-test.com", "password": "Str0ng@pass"}
    )
    other_token = other.json()["access_token"]

    assert (
        await client.get(f"/api/bookings/{booking_id}", headers=auth(other_token))
    ).status_code == 404
    assert (
        await client.get(f"/api/bookings/{booking_id}", headers=auth(admin_token))
    ).status_code == 200


async def test_status_machine_rejects_illegal_jumps(client, customer_token, admin_token, seeded):
    created = await client.post(
        "/api/bookings",
        json=booking_payload(str(seeded["route"]["_id"])),
        headers=auth(customer_token),
    )
    booking_id = created.json()["id"]

    # requested -> completed is not a legal transition.
    illegal = await client.post(
        f"/api/bookings/{booking_id}/status",
        json={"status": "completed"},
        headers=auth(admin_token),
    )
    assert illegal.status_code == 409

    legal = await client.post(
        f"/api/bookings/{booking_id}/status",
        json={"status": "confirmed"},
        headers=auth(admin_token),
    )
    assert legal.status_code == 200
    assert legal.json()["status"] == "confirmed"


async def test_customer_cannot_drive_the_status_machine(client, customer_token, seeded):
    created = await client.post(
        "/api/bookings",
        json=booking_payload(str(seeded["route"]["_id"])),
        headers=auth(customer_token),
    )
    response = await client.post(
        f"/api/bookings/{created.json()['id']}/status",
        json={"status": "confirmed"},
        headers=auth(customer_token),
    )
    assert response.status_code == 403


async def test_every_transition_is_recorded_in_history(
    client, customer_token, admin_token, seeded, manual_confirmation
):
    created = await client.post(
        "/api/bookings",
        json=booking_payload(str(seeded["route"]["_id"])),
        headers=auth(customer_token),
    )
    booking_id = created.json()["id"]
    await client.post(
        f"/api/bookings/{booking_id}/status",
        json={"status": "confirmed"},
        headers=auth(admin_token),
    )
    detail = await client.get(f"/api/bookings/{booking_id}", headers=auth(admin_token))
    history = [entry["to_status"] for entry in detail.json()["history"]]
    assert history == ["requested", "confirmed"]


async def test_cancellation_rules(client, customer_token, seeded):
    created = await client.post(
        "/api/bookings",
        json=booking_payload(str(seeded["route"]["_id"])),
        headers=auth(customer_token),
    )
    booking_id = created.json()["id"]

    cancelled = await client.post(
        f"/api/bookings/{booking_id}/cancel",
        json={"reason": "Plans changed"},
        headers=auth(customer_token),
    )
    assert cancelled.status_code == 200
    assert cancelled.json()["status"] == "cancelled"

    again = await client.post(
        f"/api/bookings/{booking_id}/cancel",
        json={"reason": "Again"},
        headers=auth(customer_token),
    )
    assert again.status_code == 409


async def test_admin_fare_override_is_recorded(client, customer_token, admin_token, seeded):
    created = await client.post(
        "/api/bookings",
        json=booking_payload(str(seeded["route"]["_id"])),
        headers=auth(customer_token),
    )
    booking_id = created.json()["id"]
    response = await client.post(
        f"/api/bookings/{booking_id}/fare",
        json={"total_fare": 3400, "reason": "Waiting time at pickup"},
        headers=auth(admin_token),
    )
    assert response.status_code == 200
    body = response.json()
    assert body["total_fare"] == 3400
    assert body["fare_overridden"] is True
    assert body["quoted_fare"] == 3000  # original system price retained


async def test_review_requires_a_completed_trip(client, customer_token, seeded):
    created = await client.post(
        "/api/bookings",
        json=booking_payload(str(seeded["route"]["_id"])),
        headers=auth(customer_token),
    )
    response = await client.post(
        "/api/reviews",
        json={"booking_id": created.json()["id"], "rating": 5},
        headers=auth(customer_token),
    )
    assert response.status_code == 409
