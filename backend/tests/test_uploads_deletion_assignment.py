"""Document uploads, account closure, and automatic driver assignment.

Each guards something that goes quietly wrong: a scan served to the wrong
person, a debt written off by closing an account, or an assignment nobody can
explain.
"""

from __future__ import annotations

import pytest
import pytest_asyncio
from bson import ObjectId

from app.core.errors import ConflictError, ValidationError
from app.db import mongodb
from app.models.enums import BookingStatus, Role
from app.schemas.common import utcnow
from app.services import driver_service, storage_service, user_service

pytestmark = pytest.mark.asyncio(loop_scope="session")

PNG = b"\x89PNG\r\n\x1a\n" + b"0" * 64
JPG = b"\xff\xd8\xff\xe0" + b"0" * 64
PDF = b"%PDF-1.4\n" + b"0" * 64


@pytest_asyncio.fixture(autouse=True, loop_scope="session")
async def temp_uploads(tmp_path_factory, monkeypatch):
    """Never write test files into the real upload directory."""
    from app.core.config import settings

    monkeypatch.setattr(settings, "UPLOAD_DIR", str(tmp_path_factory.mktemp("uploads")))
    yield


# ---------------------------------------------------------------------------
# Uploads
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("data,mime", [(PNG, "image/png"), (JPG, "image/jpeg"), (PDF, "application/pdf")])
def test_a_scan_round_trips(data, mime):
    key = storage_service.save_document(data, mime)
    read, content_type = storage_service.read_document(key)
    assert read == data
    assert content_type == mime


def test_the_key_says_nothing_about_whose_document_it_is():
    """A key that leaks in a log should not identify a driver."""
    key = storage_service.save_document(PNG, "image/png", prefix="licence")
    assert "licence" in key
    assert len(key) > 24  # the rest is random


@pytest.mark.parametrize(
    "data,mime",
    [
        (b"MZ\x90\x00executable", "image/png"),   # renamed binary
        (PNG, "application/zip"),                 # type we never accept
        (b"", "image/png"),                       # empty
    ],
)
def test_rubbish_is_refused(data, mime):
    with pytest.raises(ValidationError):
        storage_service.save_document(data, mime)


def test_an_oversized_file_is_refused():
    with pytest.raises(ValidationError):
        storage_service.save_document(PNG + b"0" * storage_service.MAX_BYTES, "image/png")


@pytest.mark.parametrize("key", ["../../../etc/passwd", "../secret.png", "nope.png"])
def test_a_key_cannot_escape_the_upload_directory(key):
    """Without this, a crafted key reads anything the process can."""
    with pytest.raises(ValidationError):
        storage_service.read_document(key)


# ---------------------------------------------------------------------------
# Account closure
# ---------------------------------------------------------------------------


async def _driver_user(balance: float = 1000.0, held: float = 0.0):
    user_id = ObjectId()
    await mongodb.users().insert_one({
        "_id": user_id, "name": "Closing Driver", "email": f"close{user_id}@t.local",
        # Phones are uniquely indexed, so every fixture driver needs its own.
        "phone": f"9{str(user_id)[-9:]}"[:10], "role": Role.DRIVER.value, "status": "active",
        "created_at": utcnow(), "updated_at": utcnow(),
    })
    await mongodb.drivers().insert_one({
        "user_id": user_id, "name": "Closing Driver", "driver_type": "owner",
        "wallet_balance": balance, "wallet_held": held,
        "bank_details": {"account_number": "123456789012", "ifsc": "HDFC0001234"},
        "documents": [{"type": "licence", "file_url": "doc_x.png"}],
    })
    return await mongodb.users().find_one({"_id": user_id})


async def test_an_overdrawn_driver_cannot_close_their_account(seeded):
    """The debt is real money owed; closing would write it off silently."""
    user = await _driver_user(balance=-6500.0)

    blockers = await user_service.deletion_blockers(user)
    assert any("overdrawn" in b for b in blockers)

    with pytest.raises(ConflictError):
        await user_service.delete_account(user)

    still = await mongodb.users().find_one({"_id": user["_id"]})
    assert still["name"] == "Closing Driver"


async def test_held_money_also_blocks_closure(seeded):
    user = await _driver_user(balance=2000.0, held=400.0)
    blockers = await user_service.deletion_blockers(user)
    assert any("held" in b for b in blockers)


async def test_a_settled_driver_can_close_and_loses_their_sensitive_data(seeded):
    user = await _driver_user(balance=1200.0)

    result = await user_service.delete_account(user, reason="Leaving the platform")
    assert result["deleted"] is True

    closed = await mongodb.users().find_one({"_id": user["_id"]})
    assert closed["name"] == "Deleted user"
    assert closed["phone"] is None
    assert closed["password_hash"] == "!deleted"

    driver = await mongodb.drivers().find_one({"user_id": user["_id"]})
    # Licence scans and bank details are the most sensitive things we hold.
    assert "bank_details" not in driver
    assert "documents" not in driver


async def test_a_live_trip_blocks_closure(seeded):
    customer = seeded["customer"]
    booking_oid = ObjectId()
    await mongodb.bookings().insert_one({
        "_id": booking_oid, "booking_id": "NM-DEL-0001", "customer_id": customer["_id"],
        "status": BookingStatus.TRIP_STARTED.value, "vehicle_type": "sedan",
        "total_fare": 1000.0, "scheduled_at": utcnow(),
        "created_at": utcnow(), "updated_at": utcnow(),
    })
    blockers = await user_service.deletion_blockers(customer)
    assert any("in progress" in b for b in blockers)
    await mongodb.bookings().delete_one({"_id": booking_oid})


# ---------------------------------------------------------------------------
# Automatic assignment
# ---------------------------------------------------------------------------


async def test_a_driver_who_cannot_cover_the_hold_is_never_chosen(seeded):
    booking = {"vehicle_type": "sedan", "total_fare": 5000.0, "_id": ObjectId()}
    broke = {
        "_id": ObjectId(), "wallet_balance": 0.0, "wallet_held": 0.0,
        "driver_type": "owner", "vehicle": {"vehicle_type": "sedan"},
    }
    verdict = await driver_service.score_for_booking(broke, booking)
    assert verdict["eligible"] is False
    assert verdict["score"] == -1.0


async def test_the_right_vehicle_class_beats_the_wrong_one(seeded):
    booking = {"vehicle_type": "sedan", "total_fare": 3000.0, "_id": ObjectId()}
    base = {"wallet_balance": 9000.0, "wallet_held": 0.0, "driver_type": "owner"}

    right = await driver_service.score_for_booking(
        {**base, "_id": ObjectId(), "vehicle": {"vehicle_type": "sedan"}}, booking
    )
    wrong = await driver_service.score_for_booking(
        {**base, "_id": ObjectId(), "vehicle": {"vehicle_type": "tempo"}}, booking
    )
    assert right["score"] > wrong["score"]
    # Wrong class is a penalty, not a disqualification — an operator will
    # sometimes send a bigger car.
    assert wrong["eligible"] is True


async def test_an_idle_driver_outranks_a_busy_one(seeded):
    booking = {"vehicle_type": "sedan", "total_fare": 3000.0, "_id": ObjectId()}
    busy_id, idle_id = ObjectId(), ObjectId()
    for i in range(2):
        await mongodb.bookings().insert_one({
            "booking_id": f"NM-BUSY-{i}", "customer_id": ObjectId(), "driver_id": busy_id,
            "status": BookingStatus.ACCEPTED.value, "vehicle_type": "sedan",
            "total_fare": 100.0, "scheduled_at": utcnow(),
            "created_at": utcnow(), "updated_at": utcnow(),
        })
    base = {"wallet_balance": 9000.0, "wallet_held": 0.0, "driver_type": "owner",
            "vehicle": {"vehicle_type": "sedan"}}

    busy = await driver_service.score_for_booking({**base, "_id": busy_id}, booking)
    idle = await driver_service.score_for_booking({**base, "_id": idle_id}, booking)
    assert idle["score"] > busy["score"]
    assert busy["active_trips"] == 2


async def test_every_choice_carries_a_reason(seeded):
    """An automatic assignment nobody can explain is one nobody will trust."""
    verdict = await driver_service.score_for_booking(
        {"_id": ObjectId(), "wallet_balance": 9000.0, "wallet_held": 0.0,
         "driver_type": "owner", "rating_avg": 4.6, "vehicle": {"vehicle_type": "sedan"}},
        {"vehicle_type": "sedan", "total_fare": 2000.0, "_id": ObjectId()},
    )
    assert verdict["reason"]
    assert "4.6" in verdict["reason"]



async def _login_driver(client):
    """A verified driver with a login, independent of the demo seed data."""
    from app.core.security import hash_password

    user_id = ObjectId()
    email = f"dash{user_id}@example.com"
    await mongodb.users().insert_one({
        "_id": user_id, "name": "Dash Driver", "email": email,
        "phone": f"9{str(user_id)[-9:]}"[:10], "role": Role.DRIVER.value,
        "status": "active", "password_hash": hash_password("Password@123"),
        "created_at": utcnow(), "updated_at": utcnow(),
    })
    driver_id = (await mongodb.drivers().insert_one({
        "user_id": user_id, "name": "Dash Driver", "driver_type": "owner",
        "status": "active", "verification_status": "verified",
        "wallet_balance": 5000.0, "wallet_held": 0.0,
        "created_at": utcnow(), "updated_at": utcnow(),
    })).inserted_id
    response = await client.post(
        "/api/auth/login", json={"email": email, "password": "Password@123"}
    )
    assert response.status_code == 200, response.text
    return driver_id, response.json()["access_token"]


# ---------------------------------------------------------------------------
# Driver dashboard
# ---------------------------------------------------------------------------


async def test_the_dashboard_never_shows_one_trip_in_three_places(client, seeded):
    """Current / today / coming up overlapped, so a live trip appeared 3×."""
    from tests.conftest import auth

    driver_id, token = await _login_driver(client)

    booking_oid = ObjectId()
    await mongodb.bookings().insert_one({
        "_id": booking_oid, "booking_id": "NM-DUP-0001", "customer_id": seeded["customer"]["_id"],
        "driver_id": driver_id, "status": BookingStatus.ACCEPTED.value,
        "vehicle_type": "sedan", "total_fare": 2000.0, "amount_paid": 0.0,
        "passenger_name": "Rider", "passenger_phone": "9876500011", "passenger_count": 1,
        "scheduled_at": utcnow(), "created_at": utcnow(), "updated_at": utcnow(),
    })

    body = (await client.get("/api/drivers/me/dashboard", headers=auth(token))).json()

    ids = []
    if body.get("current_trip"):
        ids.append(body["current_trip"]["id"])
    ids += [t["id"] for t in body.get("todays_trips", [])]
    ids += [t["id"] for t in body.get("upcoming_trips", [])]
    assert len(ids) == len(set(ids)), f"a trip is listed more than once: {ids}"

    await mongodb.bookings().delete_one({"_id": booking_oid})


async def test_the_dashboard_masks_the_customer_number(client, seeded):
    """Every other driver-facing surface masks it; this one did not."""
    from tests.conftest import auth

    driver_id, token = await _login_driver(client)

    import datetime as dt
    booking_oid = ObjectId()
    await mongodb.bookings().insert_one({
        "_id": booking_oid, "booking_id": "NM-MASK-DASH", "customer_id": seeded["customer"]["_id"],
        "driver_id": driver_id, "status": BookingStatus.DRIVER_ASSIGNED.value,
        "vehicle_type": "sedan", "total_fare": 2000.0, "amount_paid": 0.0,
        "passenger_name": "Rider", "passenger_phone": "9876500022", "passenger_count": 1,
        "scheduled_at": utcnow() + dt.timedelta(days=2),
        "created_at": utcnow(), "updated_at": utcnow(),
    })

    body = (await client.get("/api/drivers/me/dashboard", headers=auth(token))).json()

    shown = [t for t in body.get("upcoming_trips", []) if t["booking_id"] == "NM-MASK-DASH"]
    if shown:
        assert "XXXX" in shown[0]["passenger_phone"]

    await mongodb.bookings().delete_one({"_id": booking_oid})
