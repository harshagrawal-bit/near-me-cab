"""Admin-facing customer directory and lifetime value roll-ups."""

from __future__ import annotations

import re
from typing import Any

from bson import ObjectId

from app.core.errors import NotFoundError
from app.db import mongodb
from app.models.enums import BookingStatus, Role
from app.schemas.common import build_page, serialize


async def _stats_for(customer_ids: list[ObjectId]) -> dict[str, dict[str, Any]]:
    if not customer_ids:
        return {}
    pipeline = [
        {"$match": {"customer_id": {"$in": customer_ids}}},
        {
            "$group": {
                "_id": "$customer_id",
                "total_bookings": {"$sum": 1},
                "completed": {
                    "$sum": {"$cond": [{"$eq": ["$status", BookingStatus.COMPLETED.value]}, 1, 0]}
                },
                "cancelled": {
                    "$sum": {"$cond": [{"$eq": ["$status", BookingStatus.CANCELLED.value]}, 1, 0]}
                },
                "total_spend": {
                    "$sum": {
                        "$cond": [
                            {"$eq": ["$status", BookingStatus.COMPLETED.value]},
                            "$total_fare",
                            0,
                        ]
                    }
                },
                "last_booking_at": {"$max": "$created_at"},
            }
        },
    ]
    stats: dict[str, dict[str, Any]] = {}
    async for doc in mongodb.bookings().aggregate(pipeline):
        stats[str(doc["_id"])] = {
            "total_bookings": doc["total_bookings"],
            "completed": doc["completed"],
            "cancelled": doc["cancelled"],
            "total_spend": round(doc["total_spend"], 2),
            "last_booking_at": serialize(doc["last_booking_at"]),
        }
    return stats


async def list_customers(
    page: int, page_size: int, *, search: str | None = None, status: str | None = None
) -> dict[str, Any]:
    query: dict[str, Any] = {"role": Role.CUSTOMER.value}
    if status:
        query["status"] = status
    if search:
        pattern = re.escape(search.strip())
        query["$or"] = [
            {"name": {"$regex": pattern, "$options": "i"}},
            {"email": {"$regex": pattern, "$options": "i"}},
            {"phone": {"$regex": pattern, "$options": "i"}},
        ]
    total = await mongodb.users().count_documents(query)
    cursor = (
        mongodb.users()
        .find(query, {"password_hash": 0})
        .sort("created_at", -1)
        .skip((page - 1) * page_size)
        .limit(page_size)
    )
    docs = [doc async for doc in cursor]
    stats = await _stats_for([doc["_id"] for doc in docs])
    items = []
    for doc in docs:
        item = serialize(doc)
        item["stats"] = stats.get(item["id"], {
            "total_bookings": 0,
            "completed": 0,
            "cancelled": 0,
            "total_spend": 0.0,
            "last_booking_at": None,
        })
        items.append(item)
    return build_page(items, total, page, page_size)


async def customer_detail(customer_id: ObjectId) -> dict[str, Any]:
    user = await mongodb.users().find_one(
        {"_id": customer_id, "role": Role.CUSTOMER.value}, {"password_hash": 0}
    )
    if not user:
        raise NotFoundError("Customer not found.")
    stats = await _stats_for([customer_id])
    item = serialize(user)
    item["stats"] = stats.get(str(customer_id), {
        "total_bookings": 0,
        "completed": 0,
        "cancelled": 0,
        "total_spend": 0.0,
        "last_booking_at": None,
    })
    return item
