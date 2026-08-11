"""Driver profiles: verification, availability, vehicle assignment, earnings."""

from __future__ import annotations

import datetime as dt
import re
from typing import Any

from bson import ObjectId
from pymongo.errors import DuplicateKeyError

from app.core.errors import ConflictError, NotFoundError, ValidationError
from app.core.timezone import local_date, start_of_local_day
from app.db import mongodb
from app.models.enums import (
    AccountStatus,
    BookingStatus,
    DocumentStatus,
    DriverStatus,
    Role,
    VehicleStatus,
    VerificationStatus,
)
from app.schemas.common import build_page, object_id, serialize, utcnow
from app.schemas.fleet import DriverCreate, DriverSelfUpdate, DriverUpdate
from app.services import user_service, vehicle_service

USER_FIELDS = {"name", "email", "phone", "avatar_url"}


def _as_datetime(value: dt.date | dt.datetime | None) -> dt.datetime | None:
    if value is None:
        return None
    if isinstance(value, dt.datetime):
        return value if value.tzinfo else value.replace(tzinfo=dt.timezone.utc)
    return dt.datetime.combine(value, dt.time.min, tzinfo=dt.timezone.utc)


def _refresh_document_statuses(documents: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Flip any document whose expiry has passed to `expired`."""
    today = local_date(utcnow())
    refreshed = []
    for doc in documents:
        item = dict(doc)
        expires = item.get("expires_on")
        if isinstance(expires, dt.datetime):
            expires = expires.date()
        if expires and expires < today:
            item["status"] = DocumentStatus.EXPIRED.value
        refreshed.append(item)
    return refreshed


async def create_driver(payload: DriverCreate) -> dict[str, Any]:
    vehicle_oid = object_id(payload.assigned_vehicle_id, "assigned_vehicle_id") if payload.assigned_vehicle_id else None
    if vehicle_oid and not await vehicle_service.get_vehicle(vehicle_oid):
        raise NotFoundError("Vehicle not found.")

    user = await user_service.create_user(
        name=payload.name,
        email=payload.email,
        phone=payload.phone,
        password=payload.password,
        role=Role.DRIVER,
        avatar_url=payload.avatar_url,
    )

    now = utcnow()
    documents = [
        {**doc.model_dump(), "expires_on": _as_datetime(doc.expires_on)}
        for doc in payload.documents
    ]
    if not any(d["type"].lower().startswith("driving") for d in documents):
        documents.insert(
            0,
            {
                "type": "Driving Licence",
                "number": payload.licence_number,
                "status": DocumentStatus.PENDING.value,
                "expires_on": _as_datetime(payload.licence_expiry),
                "file_url": None,
            },
        )
    documents = [
        {**d, "status": d["status"].value if hasattr(d["status"], "value") else d["status"]}
        for d in documents
    ]

    document = {
        "user_id": user["_id"],
        "licence_number": payload.licence_number,
        "licence_expiry": _as_datetime(payload.licence_expiry),
        "verification_status": VerificationStatus.PENDING.value,
        "status": DriverStatus.ACTIVE.value,
        "is_available": False,
        "assigned_vehicle_id": vehicle_oid,
        "documents": _refresh_document_statuses(documents),
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

    if vehicle_oid:
        await _bind_vehicle(result.inserted_id, vehicle_oid)
    return await require_driver(result.inserted_id)


async def _bind_vehicle(driver_id: ObjectId, vehicle_id: ObjectId | None) -> None:
    """Keep the driver↔vehicle pointers on both sides consistent."""
    await mongodb.vehicles().update_many(
        {"assigned_driver_id": driver_id},
        {"$set": {"assigned_driver_id": None, "status": VehicleStatus.AVAILABLE.value}},
    )
    if vehicle_id is None:
        return
    vehicle = await mongodb.vehicles().find_one({"_id": vehicle_id})
    if not vehicle:
        raise NotFoundError("Vehicle not found.")
    other = await mongodb.drivers().find_one(
        {"assigned_vehicle_id": vehicle_id, "_id": {"$ne": driver_id}}
    )
    if other:
        raise ConflictError("That vehicle is already assigned to another driver.")
    new_status = (
        vehicle["status"]
        if vehicle["status"] in {VehicleStatus.ON_TRIP.value, VehicleStatus.MAINTENANCE.value}
        else VehicleStatus.ASSIGNED.value
    )
    await mongodb.vehicles().update_one(
        {"_id": vehicle_id},
        {"$set": {"assigned_driver_id": driver_id, "status": new_status, "updated_at": utcnow()}},
    )


async def update_driver(driver_id: ObjectId, payload: DriverUpdate) -> dict[str, Any]:
    driver = await mongodb.drivers().find_one({"_id": driver_id})
    if not driver:
        raise NotFoundError("Driver not found.")

    data = payload.model_dump(exclude_unset=True)
    user_changes = {k: v for k, v in data.items() if k in USER_FIELDS and v is not None}
    if user_changes:
        await user_service.update_user(driver["user_id"], user_changes)

    driver_changes: dict[str, Any] = {}
    if data.get("licence_number"):
        driver_changes["licence_number"] = data["licence_number"].upper().replace(" ", "")
    if data.get("licence_expiry"):
        driver_changes["licence_expiry"] = _as_datetime(data["licence_expiry"])
    if data.get("verification_status"):
        driver_changes["verification_status"] = data["verification_status"].value
    if data.get("status"):
        driver_changes["status"] = data["status"].value
        if data["status"] == DriverStatus.INACTIVE:
            driver_changes["is_available"] = False
    if data.get("documents") is not None:
        documents = [
            {**doc.model_dump(), "expires_on": _as_datetime(doc.expires_on), "status": doc.status.value}
            for doc in payload.documents or []
        ]
        driver_changes["documents"] = _refresh_document_statuses(documents)

    if "assigned_vehicle_id" in data:
        vehicle_oid = (
            object_id(data["assigned_vehicle_id"], "assigned_vehicle_id")
            if data["assigned_vehicle_id"]
            else None
        )
        await _bind_vehicle(driver_id, vehicle_oid)
        driver_changes["assigned_vehicle_id"] = vehicle_oid

    if driver_changes:
        driver_changes["updated_at"] = utcnow()
        await mongodb.drivers().update_one({"_id": driver_id}, {"$set": driver_changes})
    return await require_driver(driver_id)


async def update_own_profile(driver_id: ObjectId, payload: DriverSelfUpdate) -> dict[str, Any]:
    driver = await mongodb.drivers().find_one({"_id": driver_id})
    if not driver:
        raise NotFoundError("Driver not found.")
    changes = {k: v for k, v in payload.model_dump(exclude_unset=True).items() if v is not None}
    if changes:
        await user_service.update_user(driver["user_id"], changes)
    return await require_driver(driver_id)


async def set_availability(driver_id: ObjectId, is_available: bool) -> dict[str, Any]:
    driver = await mongodb.drivers().find_one({"_id": driver_id})
    if not driver:
        raise NotFoundError("Driver not found.")
    if is_available:
        if driver.get("status") != DriverStatus.ACTIVE.value:
            raise ValidationError("Your account is inactive. Please contact the operations team.")
        if driver.get("verification_status") != VerificationStatus.VERIFIED.value:
            raise ValidationError(
                "You can go online once your documents are verified by the operations team."
            )
    await mongodb.drivers().update_one(
        {"_id": driver_id},
        {"$set": {"is_available": is_available, "updated_at": utcnow()}},
    )
    return await require_driver(driver_id)


async def get_driver(driver_id: ObjectId) -> dict[str, Any] | None:
    return await mongodb.drivers().find_one({"_id": driver_id})


async def get_by_user_id(user_id: ObjectId) -> dict[str, Any] | None:
    return await mongodb.drivers().find_one({"user_id": user_id})


async def require_driver_for_user(user_id: ObjectId) -> dict[str, Any]:
    driver = await get_by_user_id(user_id)
    if not driver:
        raise NotFoundError("No driver profile is linked to this account.")
    return driver


async def _hydrate(driver: dict[str, Any]) -> dict[str, Any]:
    item = serialize(driver)
    item["documents"] = serialize(_refresh_document_statuses(driver.get("documents", [])))
    user = await mongodb.users().find_one({"_id": driver["user_id"]}, {"password_hash": 0})
    if user:
        item["user"] = serialize(user)
        item["name"] = user["name"]
        item["email"] = user["email"]
        item["phone"] = user["phone"]
        item["avatar_url"] = user.get("avatar_url")
        item["account_status"] = user.get("status")
    if driver.get("assigned_vehicle_id"):
        vehicle = await mongodb.vehicles().find_one({"_id": driver["assigned_vehicle_id"]})
        if vehicle:
            item["vehicle"] = serialize(vehicle)
            item["vehicle"]["class_info"] = vehicle_service.vehicle_class(vehicle["vehicle_type"])
    return item


async def require_driver(driver_id: ObjectId) -> dict[str, Any]:
    driver = await get_driver(driver_id)
    if not driver:
        raise NotFoundError("Driver not found.")
    return await _hydrate(driver)


async def list_drivers(
    page: int,
    page_size: int,
    *,
    search: str | None = None,
    status: str | None = None,
    verification_status: str | None = None,
    is_available: bool | None = None,
) -> dict[str, Any]:
    query: dict[str, Any] = {}
    if status:
        query["status"] = status
    if verification_status:
        query["verification_status"] = verification_status
    if is_available is not None:
        query["is_available"] = is_available

    if search:
        pattern = re.escape(search.strip())
        user_cursor = mongodb.users().find(
            {
                "role": Role.DRIVER.value,
                "$or": [
                    {"name": {"$regex": pattern, "$options": "i"}},
                    {"email": {"$regex": pattern, "$options": "i"}},
                    {"phone": {"$regex": pattern, "$options": "i"}},
                ],
            },
            {"_id": 1},
        )
        user_ids = [doc["_id"] async for doc in user_cursor]
        query["$or"] = [
            {"user_id": {"$in": user_ids}},
            {"licence_number": {"$regex": pattern, "$options": "i"}},
        ]

    total = await mongodb.drivers().count_documents(query)
    cursor = (
        mongodb.drivers()
        .find(query)
        .sort("created_at", -1)
        .skip((page - 1) * page_size)
        .limit(page_size)
    )
    items = [await _hydrate(doc) async for doc in cursor]
    return build_page(items, total, page, page_size)


async def assignable_drivers(vehicle_type: str | None = None) -> list[dict[str, Any]]:
    """Verified, active drivers — used to populate the assign-driver picker."""
    query: dict[str, Any] = {
        "status": DriverStatus.ACTIVE.value,
        "verification_status": VerificationStatus.VERIFIED.value,
    }
    cursor = mongodb.drivers().find(query).sort("created_at", -1).limit(200)
    drivers = [await _hydrate(doc) async for doc in cursor]
    drivers = [d for d in drivers if d.get("account_status") == AccountStatus.ACTIVE.value]
    if vehicle_type:
        drivers = [
            d for d in drivers if (d.get("vehicle") or {}).get("vehicle_type") == vehicle_type
        ]
    drivers.sort(key=lambda d: (not d.get("is_available"), d.get("name", "")))
    return drivers


async def adjust_rating(driver_id: ObjectId, rating: int) -> None:
    driver = await mongodb.drivers().find_one({"_id": driver_id})
    if not driver:
        return
    count = int(driver.get("rating_count", 0)) + 1
    total = float(driver.get("rating_avg", 0)) * int(driver.get("rating_count", 0)) + rating
    await mongodb.drivers().update_one(
        {"_id": driver_id},
        {"$set": {"rating_avg": round(total / count, 2), "rating_count": count}},
    )


async def earnings_summary(driver_id: ObjectId) -> dict[str, Any]:
    """Backend-calculated earnings. Only completed trips count."""
    # Windows are business-local days, so "today" matches what the driver
    # experienced rather than a UTC day that ends at 05:30 IST.
    now = utcnow()
    start_of_day = start_of_local_day(now)
    start_of_week = start_of_local_day(now - dt.timedelta(days=local_date(now).weekday()))
    start_of_month = start_of_local_day(now.replace(day=1))

    async def window(since: dt.datetime | None) -> dict[str, Any]:
        match: dict[str, Any] = {
            "driver_id": driver_id,
            "status": BookingStatus.COMPLETED.value,
        }
        if since:
            match["completed_at"] = {"$gte": since}
        pipeline = [
            {"$match": match},
            {
                "$group": {
                    "_id": None,
                    "earnings": {"$sum": "$total_fare"},
                    "trips": {"$sum": 1},
                }
            },
        ]
        async for doc in mongodb.bookings().aggregate(pipeline):
            return {"earnings": round(doc["earnings"], 2), "trips": doc["trips"]}
        return {"earnings": 0.0, "trips": 0}

    today, week, month, lifetime = (
        await window(start_of_day),
        await window(start_of_week),
        await window(start_of_month),
        await window(None),
    )

    # Last 7 days, oldest first — feeds the earnings bar chart.
    daily = []
    for offset in range(6, -1, -1):
        day_start = start_of_day - dt.timedelta(days=offset)
        day_end = day_start + dt.timedelta(days=1)
        pipeline = [
            {
                "$match": {
                    "driver_id": driver_id,
                    "status": BookingStatus.COMPLETED.value,
                    "completed_at": {"$gte": day_start, "$lt": day_end},
                }
            },
            {"$group": {"_id": None, "earnings": {"$sum": "$total_fare"}, "trips": {"$sum": 1}}},
        ]
        entry = {"date": local_date(day_start).isoformat(), "earnings": 0.0, "trips": 0}
        async for doc in mongodb.bookings().aggregate(pipeline):
            entry["earnings"] = round(doc["earnings"], 2)
            entry["trips"] = doc["trips"]
        daily.append(entry)

    return {
        "today": today,
        "week": week,
        "month": month,
        "lifetime": lifetime,
        "daily": daily,
    }
