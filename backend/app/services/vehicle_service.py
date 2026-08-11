"""Vehicle catalogue and fleet availability."""

from __future__ import annotations

import re
from typing import Any

from bson import ObjectId
from pymongo.errors import DuplicateKeyError

from app.core.errors import ConflictError, NotFoundError
from app.db import mongodb
from app.models.enums import VehicleStatus, VehicleType
from app.schemas.common import build_page, serialize, utcnow
from app.schemas.fleet import VehicleCreate, VehicleUpdate

#: Presentation metadata for each class of vehicle. Seating is the marketed
#: passenger capacity used on the fare-options screen.
VEHICLE_CLASSES: dict[str, dict[str, Any]] = {
    VehicleType.HATCHBACK.value: {
        "label": "Hatchback",
        "seating_capacity": 4,
        "description": "Compact and economical for city runs",
        "order": 1,
    },
    VehicleType.SEDAN.value: {
        "label": "Sedan",
        "seating_capacity": 4,
        "description": "Comfortable ride for up to 4 passengers",
        "order": 2,
    },
    VehicleType.SUV.value: {
        "label": "SUV",
        "seating_capacity": 6,
        "description": "Extra room for luggage and larger groups",
        "order": 3,
    },
    VehicleType.PREMIUM.value: {
        "label": "Premium",
        "seating_capacity": 6,
        "description": "Top-end cars with the most legroom",
        "order": 4,
    },
    VehicleType.TEMPO.value: {
        "label": "Tempo Traveller",
        "seating_capacity": 12,
        "description": "Group travel with generous luggage space",
        "order": 5,
    },
}


def vehicle_class(vehicle_type: str) -> dict[str, Any]:
    return VEHICLE_CLASSES.get(
        vehicle_type,
        {"label": vehicle_type.title(), "seating_capacity": 4, "description": None, "order": 99},
    )


def list_vehicle_classes() -> list[dict[str, Any]]:
    return [
        {"vehicle_type": key, **meta}
        for key, meta in sorted(VEHICLE_CLASSES.items(), key=lambda kv: kv[1]["order"])
    ]


async def create_vehicle(payload: VehicleCreate) -> dict[str, Any]:
    now = utcnow()
    document = {
        **payload.model_dump(),
        "vehicle_type": payload.vehicle_type.value,
        "status": payload.status.value,
        "assigned_driver_id": None,
        "created_at": now,
        "updated_at": now,
    }
    try:
        result = await mongodb.vehicles().insert_one(document)
    except DuplicateKeyError:
        raise ConflictError("A vehicle with this registration number already exists.")
    document["_id"] = result.inserted_id
    return serialize(document)


async def update_vehicle(vehicle_id: ObjectId, payload: VehicleUpdate) -> dict[str, Any]:
    changes = {k: v for k, v in payload.model_dump(exclude_unset=True).items() if v is not None}
    if "vehicle_type" in changes:
        changes["vehicle_type"] = changes["vehicle_type"].value
    if "status" in changes:
        changes["status"] = changes["status"].value
    if changes:
        changes["updated_at"] = utcnow()
        try:
            result = await mongodb.vehicles().update_one({"_id": vehicle_id}, {"$set": changes})
        except DuplicateKeyError:
            raise ConflictError("Another vehicle already uses this registration number.")
        if result.matched_count == 0:
            raise NotFoundError("Vehicle not found.")
    return await require_vehicle(vehicle_id)


async def delete_vehicle(vehicle_id: ObjectId) -> None:
    in_use = await mongodb.bookings().count_documents({"vehicle_id": vehicle_id}, limit=1)
    if in_use:
        raise ConflictError(
            "This vehicle appears on bookings. Set it to inactive instead of deleting."
        )
    await mongodb.drivers().update_many(
        {"assigned_vehicle_id": vehicle_id}, {"$set": {"assigned_vehicle_id": None}}
    )
    result = await mongodb.vehicles().delete_one({"_id": vehicle_id})
    if result.deleted_count == 0:
        raise NotFoundError("Vehicle not found.")


async def get_vehicle(vehicle_id: ObjectId) -> dict[str, Any] | None:
    return await mongodb.vehicles().find_one({"_id": vehicle_id})


async def require_vehicle(vehicle_id: ObjectId) -> dict[str, Any]:
    vehicle = await get_vehicle(vehicle_id)
    if not vehicle:
        raise NotFoundError("Vehicle not found.")
    return serialize(vehicle)


async def list_vehicles(
    page: int,
    page_size: int,
    *,
    search: str | None = None,
    status: str | None = None,
    vehicle_type: str | None = None,
) -> dict[str, Any]:
    query: dict[str, Any] = {}
    if status:
        query["status"] = status
    if vehicle_type:
        query["vehicle_type"] = vehicle_type
    if search:
        pattern = re.escape(search.strip())
        query["$or"] = [
            {"registration_number": {"$regex": pattern, "$options": "i"}},
            {"model": {"$regex": pattern, "$options": "i"}},
        ]
    total = await mongodb.vehicles().count_documents(query)
    cursor = (
        mongodb.vehicles()
        .find(query)
        .sort("created_at", -1)
        .skip((page - 1) * page_size)
        .limit(page_size)
    )
    items = []
    async for doc in cursor:
        item = serialize(doc)
        item["class_info"] = vehicle_class(doc["vehicle_type"])
        items.append(item)
    await _attach_driver_names(items)
    return build_page(items, total, page, page_size)


async def _attach_driver_names(items: list[dict[str, Any]]) -> None:
    driver_ids = [ObjectId(i["assigned_driver_id"]) for i in items if i.get("assigned_driver_id")]
    if not driver_ids:
        return
    pipeline = [
        {"$match": {"_id": {"$in": driver_ids}}},
        {
            "$lookup": {
                "from": "users",
                "localField": "user_id",
                "foreignField": "_id",
                "as": "user",
            }
        },
        {"$unwind": "$user"},
        {"$project": {"name": "$user.name"}},
    ]
    names = {str(doc["_id"]): doc["name"] async for doc in mongodb.drivers().aggregate(pipeline)}
    for item in items:
        item["assigned_driver_name"] = names.get(item.get("assigned_driver_id") or "")


async def count_available_by_type() -> dict[str, int]:
    """How many vehicles of each class are bookable right now."""
    pipeline = [
        {"$match": {"status": {"$in": [VehicleStatus.AVAILABLE.value, VehicleStatus.ASSIGNED.value]}}},
        {"$group": {"_id": "$vehicle_type", "count": {"$sum": 1}}},
    ]
    return {doc["_id"]: doc["count"] async for doc in mongodb.vehicles().aggregate(pipeline)}


async def set_status(vehicle_id: ObjectId, status: VehicleStatus) -> None:
    await mongodb.vehicles().update_one(
        {"_id": vehicle_id}, {"$set": {"status": status.value, "updated_at": utcnow()}}
    )
