"""Trip reviews and moderation."""

from __future__ import annotations

from typing import Any

from bson import ObjectId
from pymongo.errors import DuplicateKeyError

from app.core.errors import ConflictError, NotFoundError, PermissionError_
from app.db import mongodb
from app.models.enums import BookingStatus
from app.schemas.booking import ReviewCreate, ReviewModerate
from app.schemas.common import build_page, object_id, serialize, utcnow
from app.services import driver_service


async def create_review(customer: dict[str, Any], payload: ReviewCreate) -> dict[str, Any]:
    booking_oid = object_id(payload.booking_id, "booking_id")
    booking = await mongodb.bookings().find_one({"_id": booking_oid})
    if not booking:
        raise NotFoundError("Booking not found.")
    if booking["customer_id"] != customer["_id"]:
        raise PermissionError_("You can only review your own trips.")
    if booking["status"] != BookingStatus.COMPLETED.value:
        raise ConflictError("You can review a trip once it is completed.")

    now = utcnow()
    document = {
        "booking_id": booking_oid,
        "booking_reference": booking["booking_id"],
        "customer_id": customer["_id"],
        "driver_id": booking.get("driver_id"),
        "rating": payload.rating,
        "comment": payload.comment,
        "is_published": True,
        "moderation_note": None,
        "created_at": now,
        "updated_at": now,
    }
    try:
        result = await mongodb.reviews().insert_one(document)
    except DuplicateKeyError:
        raise ConflictError("You have already reviewed this trip.")
    document["_id"] = result.inserted_id

    if booking.get("driver_id"):
        await driver_service.adjust_rating(booking["driver_id"], payload.rating)
    return serialize(document)


async def moderate(review_id: ObjectId, payload: ReviewModerate) -> dict[str, Any]:
    result = await mongodb.reviews().update_one(
        {"_id": review_id},
        {
            "$set": {
                "is_published": payload.is_published,
                "moderation_note": payload.moderation_note,
                "updated_at": utcnow(),
            }
        },
    )
    if result.matched_count == 0:
        raise NotFoundError("Review not found.")
    doc = await mongodb.reviews().find_one({"_id": review_id})
    return serialize(doc)


async def delete_review(review_id: ObjectId) -> None:
    result = await mongodb.reviews().delete_one({"_id": review_id})
    if result.deleted_count == 0:
        raise NotFoundError("Review not found.")


async def _hydrate(review: dict[str, Any]) -> dict[str, Any]:
    item = serialize(review)
    customer = await mongodb.users().find_one({"_id": review["customer_id"]}, {"name": 1})
    item["customer_name"] = customer["name"] if customer else "Customer"
    if review.get("driver_id"):
        driver = await mongodb.drivers().find_one({"_id": review["driver_id"]})
        if driver:
            user = await mongodb.users().find_one({"_id": driver["user_id"]}, {"name": 1})
            item["driver_name"] = user["name"] if user else None
    return item


async def list_reviews(
    page: int,
    page_size: int,
    *,
    driver_id: ObjectId | None = None,
    is_published: bool | None = None,
    min_rating: int | None = None,
) -> dict[str, Any]:
    query: dict[str, Any] = {}
    if driver_id:
        query["driver_id"] = driver_id
    if is_published is not None:
        query["is_published"] = is_published
    if min_rating:
        query["rating"] = {"$gte": min_rating}
    total = await mongodb.reviews().count_documents(query)
    cursor = (
        mongodb.reviews()
        .find(query)
        .sort("created_at", -1)
        .skip((page - 1) * page_size)
        .limit(page_size)
    )
    items = [await _hydrate(doc) async for doc in cursor]
    return build_page(items, total, page, page_size)


async def reviewable_bookings(customer_id: ObjectId, limit: int = 10) -> list[dict[str, Any]]:
    """Completed trips this customer has not reviewed yet."""
    reviewed = {
        doc["booking_id"]
        async for doc in mongodb.reviews().find({"customer_id": customer_id}, {"booking_id": 1})
    }
    cursor = (
        mongodb.bookings()
        .find(
            {
                "customer_id": customer_id,
                "status": BookingStatus.COMPLETED.value,
                "_id": {"$nin": list(reviewed)},
            }
        )
        .sort("completed_at", -1)
        .limit(limit)
    )
    return [serialize(doc) async for doc in cursor]
