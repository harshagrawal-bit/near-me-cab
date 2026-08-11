"""Route catalogue: origin/destination pairs the business actually serves."""

from __future__ import annotations

import re
from typing import Any

from bson import ObjectId
from pymongo.errors import DuplicateKeyError

from app.core.errors import ConflictError, NotFoundError
from app.db import mongodb
from app.schemas.common import build_page, serialize, utcnow
from app.schemas.fleet import RouteCreate, RouteUpdate


def place_key(value: str) -> str:
    """Normalise a place name so 'Pune ', 'pune' and 'PUNE' collapse together."""
    return re.sub(r"[^a-z0-9]+", "", (value or "").lower())


def default_name(origin: str, destination: str) -> str:
    return f"{origin.strip()} → {destination.strip()}"


async def create_route(payload: RouteCreate) -> dict[str, Any]:
    now = utcnow()
    document = {
        "origin": payload.origin.strip(),
        "destination": payload.destination.strip(),
        "origin_key": place_key(payload.origin),
        "destination_key": place_key(payload.destination),
        "name": (payload.name or default_name(payload.origin, payload.destination)).strip(),
        "distance_km": float(payload.distance_km),
        "duration_minutes": int(payload.duration_minutes),
        "is_active": payload.is_active,
        "created_at": now,
        "updated_at": now,
    }
    try:
        result = await mongodb.routes().insert_one(document)
    except DuplicateKeyError:
        raise ConflictError("This origin and destination pair already exists.")
    document["_id"] = result.inserted_id
    return serialize(document)


async def update_route(route_id: ObjectId, payload: RouteUpdate) -> dict[str, Any]:
    changes = {k: v for k, v in payload.model_dump(exclude_unset=True).items() if v is not None}
    if "origin" in changes:
        changes["origin"] = changes["origin"].strip()
        changes["origin_key"] = place_key(changes["origin"])
    if "destination" in changes:
        changes["destination"] = changes["destination"].strip()
        changes["destination_key"] = place_key(changes["destination"])
    if changes:
        changes["updated_at"] = utcnow()
        try:
            result = await mongodb.routes().update_one({"_id": route_id}, {"$set": changes})
        except DuplicateKeyError:
            raise ConflictError("Another route already covers this origin and destination.")
        if result.matched_count == 0:
            raise NotFoundError("Route not found.")
    return await require_route(route_id)


async def delete_route(route_id: ObjectId) -> None:
    in_use = await mongodb.bookings().count_documents({"route_id": route_id}, limit=1)
    if in_use:
        raise ConflictError(
            "This route has bookings against it. Mark it inactive instead of deleting."
        )
    await mongodb.pricing().delete_many({"route_id": route_id})
    result = await mongodb.routes().delete_one({"_id": route_id})
    if result.deleted_count == 0:
        raise NotFoundError("Route not found.")


async def get_route(route_id: ObjectId) -> dict[str, Any] | None:
    return await mongodb.routes().find_one({"_id": route_id})


async def require_route(route_id: ObjectId) -> dict[str, Any]:
    route = await get_route(route_id)
    if not route:
        raise NotFoundError("Route not found.")
    return serialize(route)


async def require_active_route(route_id: ObjectId) -> dict[str, Any]:
    route = await get_route(route_id)
    if not route:
        raise NotFoundError("Route not found.")
    if not route.get("is_active", True):
        raise NotFoundError("This route is not currently available for booking.")
    return route


async def find_by_places(origin: str, destination: str) -> dict[str, Any] | None:
    return await mongodb.routes().find_one(
        {
            "origin_key": place_key(origin),
            "destination_key": place_key(destination),
            "is_active": True,
        }
    )


async def search_routes(term: str | None, limit: int = 20) -> list[dict[str, Any]]:
    query: dict[str, Any] = {"is_active": True}
    if term:
        pattern = re.escape(term.strip())
        query["$or"] = [
            {"origin": {"$regex": pattern, "$options": "i"}},
            {"destination": {"$regex": pattern, "$options": "i"}},
            {"name": {"$regex": pattern, "$options": "i"}},
        ]
    cursor = mongodb.routes().find(query).sort("name", 1).limit(limit)
    return [serialize(doc) async for doc in cursor]


async def list_routes(
    page: int, page_size: int, *, search: str | None = None, is_active: bool | None = None
) -> dict[str, Any]:
    query: dict[str, Any] = {}
    if is_active is not None:
        query["is_active"] = is_active
    if search:
        pattern = re.escape(search.strip())
        query["$or"] = [
            {"origin": {"$regex": pattern, "$options": "i"}},
            {"destination": {"$regex": pattern, "$options": "i"}},
            {"name": {"$regex": pattern, "$options": "i"}},
        ]
    total = await mongodb.routes().count_documents(query)
    cursor = (
        mongodb.routes().find(query).sort("name", 1).skip((page - 1) * page_size).limit(page_size)
    )
    items = [serialize(doc) async for doc in cursor]
    return build_page(items, total, page, page_size)


async def popular_routes(limit: int = 6) -> list[dict[str, Any]]:
    """Most-booked active routes, falling back to the shortest-distance ones."""
    pipeline = [
        {"$group": {"_id": "$route_id", "bookings": {"$sum": 1}}},
        {"$sort": {"bookings": -1}},
        {"$limit": limit},
    ]
    counts = {doc["_id"]: doc["bookings"] async for doc in mongodb.bookings().aggregate(pipeline)}
    ids = [rid for rid in counts if rid is not None]

    routes: list[dict[str, Any]] = []
    if ids:
        cursor = mongodb.routes().find({"_id": {"$in": ids}, "is_active": True})
        routes = [serialize(doc) async for doc in cursor]
        routes.sort(key=lambda r: counts.get(ObjectId(r["id"]), 0), reverse=True)

    if len(routes) < limit:
        seen = {r["id"] for r in routes}
        cursor = mongodb.routes().find({"is_active": True}).sort("distance_km", 1).limit(limit * 2)
        async for doc in cursor:
            item = serialize(doc)
            if item["id"] not in seen:
                routes.append(item)
                seen.add(item["id"])
            if len(routes) >= limit:
                break
    return routes[:limit]
