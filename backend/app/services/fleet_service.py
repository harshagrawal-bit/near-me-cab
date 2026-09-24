"""Fleet owners: self-signup, employed drivers, owned vehicles, taking work.

The distinction that drives this module: an OWNER holds the security deposit
and the vehicles; an EMPLOYED driver holds neither and only ever sees trips
assigned to them. Both are `role=driver` users, so the existing RBAC applies
unchanged — the extra authority an owner has is checked here, per operation,
against the stored `driver_type`. A client cannot claim to be an owner.
"""

from __future__ import annotations

import datetime as dt
from typing import Any

from bson import ObjectId
from pymongo.errors import DuplicateKeyError

from app.core.errors import ConflictError, NotFoundError, PermissionError_, ValidationError
from app.db import mongodb
from app.models.enums import (
    ACTIVE_BOOKING_STATUSES,
    BookingStatus,
    DocumentStatus,
    DriverStatus,
    DriverType,
    NotificationType,
    Role,
    VehicleStatus,
    VerificationStatus,
)
from app.schemas.common import object_id, serialize, utcnow
from app.schemas.wallet import (
    BookingAcceptance,
    DocumentUpload,
    DriverSignup,
    OwnerVehicleCreate,
    SubDriverCreate,
)
from app.services import (
    driver_service,
    notification_service,
    settings_service,
    user_service,
    wallet_service,
)


def _as_datetime(value: dt.date | dt.datetime | None) -> dt.datetime | None:
    if value is None:
        return None
    if isinstance(value, dt.datetime):
        return value
    return dt.datetime.combine(value, dt.time.min, tzinfo=dt.timezone.utc)


def _licence_document(number: str, expiry: dt.date | None) -> dict[str, Any]:
    return {
        "type": "Driving Licence",
        "number": number,
        "status": DocumentStatus.PENDING.value,
        "expires_on": _as_datetime(expiry),
        "file_url": None,
    }


# ---------------------------------------------------------------------------
# Signup
# ---------------------------------------------------------------------------


async def signup_owner(payload: DriverSignup) -> tuple[dict[str, Any], dict[str, Any]]:
    """Public driver sign-up. Always creates an unverified owner.

    Verification status and wallet balance are set here, never taken from the
    request — a driver cannot arrive pre-verified or pre-funded.
    """
    user = await user_service.create_user(
        name=payload.name,
        email=payload.email,
        phone=payload.phone,
        password=payload.password,
        role=Role.DRIVER,
    )

    now = utcnow()
    document = {
        "user_id": user["_id"],
        "driver_type": DriverType.OWNER.value,
        "owner_id": None,
        "licence_number": payload.licence_number,
        "licence_expiry": _as_datetime(payload.licence_expiry),
        "verification_status": VerificationStatus.PENDING.value,
        "status": DriverStatus.ACTIVE.value,
        "is_available": False,
        "assigned_vehicle_id": None,
        "documents": [_licence_document(payload.licence_number, payload.licence_expiry)],
        "wallet_balance": 0.0,
        "wallet_held": 0.0,
        "rating_avg": 0.0,
        "rating_count": 0,
        "total_trips": 0,
        "created_at": now,
        "updated_at": now,
    }
    try:
        result = await mongodb.drivers().insert_one(document)
    except DuplicateKeyError:
        # Roll the user back so a half-made account cannot block a retry.
        await mongodb.users().delete_one({"_id": user["_id"]})
        raise ConflictError("A driver profile already exists for this account.")

    settings = await settings_service.get_settings()
    await notification_service.notify(
        user_id=user["_id"],
        notification_type=NotificationType.ACCOUNT,
        title="Driver account created",
        body=(
            "Upload your licence for verification and top up your wallet to "
            f"₹{settings.wallet.min_balance:,.0f} to start accepting trips."
        ),
    )
    driver = await driver_service.require_driver(result.inserted_id)
    return driver, user


# ---------------------------------------------------------------------------
# Owner context
# ---------------------------------------------------------------------------


async def require_owner(user_id: ObjectId) -> dict[str, Any]:
    """Resolve the signed-in user to a fleet owner, or refuse.

    An employed driver reaching an owner-only route is a permission failure,
    not a 404 — they exist, they simply may not do this.
    """
    driver = await driver_service.require_driver_for_user(user_id)
    if driver.get("driver_type") != DriverType.OWNER.value:
        raise PermissionError_("Only fleet owners can manage vehicles, drivers and the wallet.")
    return driver


async def _owner_of(driver: dict[str, Any]) -> ObjectId:
    """The owner id a driver's work belongs to (itself, if it is an owner)."""
    if driver.get("driver_type") == DriverType.OWNER.value:
        return driver["_id"]
    return driver.get("owner_id")


# ---------------------------------------------------------------------------
# Employed drivers
# ---------------------------------------------------------------------------


async def add_sub_driver(owner: dict[str, Any], payload: SubDriverCreate) -> dict[str, Any]:
    user = await user_service.create_user(
        name=payload.name,
        email=payload.email,
        phone=payload.phone,
        password=payload.password,
        role=Role.DRIVER,
    )
    now = utcnow()
    document = {
        "user_id": user["_id"],
        "driver_type": DriverType.EMPLOYED.value,
        "owner_id": owner["_id"],
        "licence_number": payload.licence_number,
        "licence_expiry": _as_datetime(payload.licence_expiry),
        "verification_status": VerificationStatus.PENDING.value,
        "status": DriverStatus.ACTIVE.value,
        "is_available": True,
        "assigned_vehicle_id": None,
        "documents": [_licence_document(payload.licence_number, payload.licence_expiry)],
        # Employed drivers hold no deposit — the owner's wallet backs the work.
        "wallet_balance": 0.0,
        "wallet_held": 0.0,
        "rating_avg": 0.0,
        "rating_count": 0,
        "total_trips": 0,
        "created_at": now,
        "updated_at": now,
    }
    try:
        result = await mongodb.drivers().insert_one(document)
    except DuplicateKeyError:
        await mongodb.users().delete_one({"_id": user["_id"]})
        raise ConflictError("A driver profile already exists for this account.")

    await notification_service.notify(
        user_id=user["_id"],
        notification_type=NotificationType.ACCOUNT,
        title="You have been added as a driver",
        body=f"{owner.get('name') or 'Your fleet owner'} added you. Sign in to see your trips.",
    )
    return await driver_service.require_driver(result.inserted_id)


async def list_sub_drivers(owner: dict[str, Any]) -> list[dict[str, Any]]:
    cursor = mongodb.drivers().find({"owner_id": owner["_id"]}).sort("created_at", -1)
    return [await driver_service._hydrate(doc) async for doc in cursor]


async def set_sub_driver_status(
    owner: dict[str, Any], driver_id: ObjectId, active: bool
) -> dict[str, Any]:
    """Suspend or restore an employed driver.

    Scoped by `owner_id` in the query so one owner can never touch another
    owner's staff, even with a valid id.
    """
    driver = await mongodb.drivers().find_one({"_id": driver_id, "owner_id": owner["_id"]})
    if not driver:
        raise NotFoundError("Driver not found in your fleet.")

    if not active:
        live = await mongodb.bookings().count_documents(
            {"driver_id": driver_id, "status": {"$in": list(ACTIVE_BOOKING_STATUSES)}}
        )
        if live:
            raise ConflictError("This driver is on a live trip. Finish or reassign it first.")

    await mongodb.drivers().update_one(
        {"_id": driver_id},
        {
            "$set": {
                "status": (DriverStatus.ACTIVE if active else DriverStatus.INACTIVE).value,
                "is_available": active,
                "updated_at": utcnow(),
            }
        },
    )
    return await driver_service.require_driver(driver_id)


# ---------------------------------------------------------------------------
# Vehicles
# ---------------------------------------------------------------------------


async def add_vehicle(owner: dict[str, Any], payload: OwnerVehicleCreate) -> dict[str, Any]:
    now = utcnow()
    document = {
        **payload.model_dump(),
        "vehicle_type": payload.vehicle_type.value,
        "status": VehicleStatus.AVAILABLE.value,
        "owner_driver_id": owner["_id"],
        "assigned_driver_id": None,
        "notes": None,
        "created_at": now,
        "updated_at": now,
    }
    try:
        result = await mongodb.vehicles().insert_one(document)
    except DuplicateKeyError:
        raise ConflictError("A vehicle with that registration number already exists.")
    doc = await mongodb.vehicles().find_one({"_id": result.inserted_id})
    return serialize(doc)


async def list_vehicles(owner: dict[str, Any]) -> list[dict[str, Any]]:
    cursor = mongodb.vehicles().find({"owner_driver_id": owner["_id"]}).sort("created_at", -1)
    return [serialize(doc) async for doc in cursor]


async def remove_vehicle(owner: dict[str, Any], vehicle_id: ObjectId) -> None:
    vehicle = await mongodb.vehicles().find_one(
        {"_id": vehicle_id, "owner_driver_id": owner["_id"]}
    )
    if not vehicle:
        raise NotFoundError("Vehicle not found in your fleet.")
    live = await mongodb.bookings().count_documents(
        {"vehicle_id": vehicle_id, "status": {"$in": list(ACTIVE_BOOKING_STATUSES)}}
    )
    if live:
        raise ConflictError("This vehicle is on a live trip. Finish or reassign it first.")
    await mongodb.vehicles().delete_one({"_id": vehicle_id})


# ---------------------------------------------------------------------------
# Documents
# ---------------------------------------------------------------------------


async def upload_document(driver_id: ObjectId, payload: DocumentUpload) -> dict[str, Any]:
    """Add or replace a document, always landing in PENDING.

    A driver submitting a document can never mark it verified — only an admin
    can, through the existing driver update route.
    """
    entry = {
        "type": payload.type,
        "number": payload.number,
        "status": DocumentStatus.PENDING.value,
        "expires_on": _as_datetime(payload.expires_on),
        "file_url": payload.file_url,
    }
    # Replace any existing document of the same type rather than accumulating.
    await mongodb.drivers().update_one(
        {"_id": driver_id}, {"$pull": {"documents": {"type": payload.type}}}
    )
    await mongodb.drivers().update_one(
        {"_id": driver_id},
        {
            "$push": {"documents": entry},
            "$set": {
                "verification_status": VerificationStatus.PENDING.value,
                "updated_at": utcnow(),
            },
        },
    )
    return await driver_service.require_driver(driver_id)


# ---------------------------------------------------------------------------
# Taking work
# ---------------------------------------------------------------------------


async def open_bookings(owner: dict[str, Any], limit: int = 50) -> list[dict[str, Any]]:
    """Confirmed, paid, unassigned trips an owner could take."""
    from app.services import booking_service

    cursor = (
        mongodb.bookings()
        .find({"status": BookingStatus.CONFIRMED.value, "driver_id": None})
        .sort("scheduled_at", 1)
        .limit(limit)
    )
    raw = [doc async for doc in cursor]
    settings = await settings_service.get_settings()
    out = []
    for doc in raw:
        # Masked: these are trips nobody has accepted yet, so the browsing
        # driver has even less claim to the number than an assigned one.
        hydrated = await booking_service.hydrate(doc, viewer_role=Role.DRIVER.value)
        hydrated["wallet_required"] = wallet_service.required_for_booking(doc, settings.wallet)
        out.append(hydrated)
    return out


async def accept_booking(
    owner: dict[str, Any], booking_id: ObjectId, payload: BookingAcceptance
) -> dict[str, Any]:
    """Owner takes a trip: verify the car and driver are theirs, hold the deposit, assign.

    Order matters. The wallet hold happens *before* the booking is assigned, so
    a driver who cannot cover the trip never ends up attached to it. If the
    assignment then fails, the hold is released rather than stranded.
    """
    from app.services import booking_service

    booking = await mongodb.bookings().find_one({"_id": booking_id})
    if not booking:
        raise NotFoundError("Booking not found.")
    if booking.get("driver_id"):
        raise ConflictError("This trip has already been taken.")
    if booking.get("status") != BookingStatus.CONFIRMED.value:
        raise ConflictError("This trip is not open for acceptance.")

    if owner.get("verification_status") != VerificationStatus.VERIFIED.value:
        raise ValidationError("Your account is not verified yet. Upload your documents first.")

    vehicle_oid = object_id(payload.vehicle_id, "vehicle_id")
    driver_oid = object_id(payload.driver_id, "driver_id")

    vehicle = await mongodb.vehicles().find_one(
        {"_id": vehicle_oid, "owner_driver_id": owner["_id"]}
    )
    if not vehicle:
        raise NotFoundError("That vehicle is not in your fleet.")
    if vehicle.get("status") in {VehicleStatus.MAINTENANCE.value, VehicleStatus.INACTIVE.value}:
        raise ValidationError("That vehicle is not currently in service.")

    # The nominated driver must be the owner themselves or one of their staff.
    if driver_oid == owner["_id"]:
        driver = owner
    else:
        driver = await mongodb.drivers().find_one(
            {"_id": driver_oid, "owner_id": owner["_id"]}
        )
        if not driver:
            raise NotFoundError("That driver is not in your fleet.")
    if driver.get("status") != DriverStatus.ACTIVE.value:
        raise ValidationError("That driver is not active.")

    settings = await settings_service.get_settings()
    check = await wallet_service.eligibility(owner, booking)
    if not check["eligible"]:
        raise ConflictError(check["reason"])

    required = wallet_service.required_for_booking(booking, settings.wallet)
    await wallet_service.hold(owner["_id"], booking_id, required)

    try:
        # Claim the trip conditionally: two owners accepting at the same instant
        # must not both win. Whoever's update matches `driver_id: None` gets it.
        claimed = await mongodb.bookings().find_one_and_update(
            {"_id": booking_id, "driver_id": None, "status": BookingStatus.CONFIRMED.value},
            {
                "$set": {
                    "driver_id": driver_oid,
                    "vehicle_id": vehicle_oid,
                    "fleet_owner_id": owner["_id"],
                    "updated_at": utcnow(),
                }
            },
            return_document=True,
        )
        if not claimed:
            raise ConflictError("This trip has already been taken.")

        await booking_service._apply_status(
            claimed,
            BookingStatus.DRIVER_ASSIGNED,
            actor_id=owner["user_id"],
            actor_role=Role.DRIVER.value,
            note="Accepted by fleet owner.",
        )
    except Exception:
        # Never strand a hold on a trip that was not taken.
        await wallet_service.release(owner["_id"], booking_id)
        raise

    await notification_service.notify(
        user_id=driver["user_id"],
        notification_type=NotificationType.DRIVER_ASSIGNED,
        title=f"New trip {booking['booking_id']}",
        body=f"Pickup at {booking['pickup']['address']}.",
        booking_id=booking_id,
        data={"booking_id": booking["booking_id"]},
    )
    return await booking_service.require_booking(booking_id)
