"""Coupon management and discount arithmetic."""

from __future__ import annotations

from typing import Any

from bson import ObjectId
from pymongo.errors import DuplicateKeyError

from app.core.errors import ConflictError, NotFoundError
from app.db import mongodb
from app.models.enums import DiscountType
from app.schemas.booking import CouponCreate, CouponUpdate
from app.schemas.common import build_page, serialize, utcnow


def to_public(coupon: dict[str, Any] | None) -> dict[str, Any] | None:
    """The subset of a coupon a customer is allowed to see."""
    if not coupon:
        return None
    return {
        "code": coupon["code"],
        "description": coupon.get("description"),
        "discount_type": coupon["discount_type"],
        "discount_value": coupon["discount_value"],
        "min_booking_value": coupon.get("min_booking_value", 0),
        "max_discount": coupon.get("max_discount"),
    }


def discount_for(coupon: dict[str, Any] | None, subtotal: float) -> float:
    if not coupon:
        return 0.0
    if subtotal < float(coupon.get("min_booking_value") or 0):
        return 0.0
    if coupon["discount_type"] == DiscountType.PERCENT.value:
        amount = subtotal * float(coupon["discount_value"]) / 100.0
    else:
        amount = float(coupon["discount_value"])
    cap = coupon.get("max_discount")
    if cap is not None:
        amount = min(amount, float(cap))
    return round(min(amount, subtotal), 2)


async def get_active(code: str | None) -> dict[str, Any] | None:
    if not code:
        return None
    now = utcnow()
    coupon = await mongodb.coupons().find_one(
        {
            "code": code.upper().strip(),
            "is_active": True,
            "$or": [{"expires_at": None}, {"expires_at": {"$gte": now}}],
        }
    )
    if not coupon:
        return None
    limit = coupon.get("usage_limit")
    if limit is not None and coupon.get("used_count", 0) >= limit:
        return None
    return coupon


async def consume(code: str) -> None:
    """Increment usage after a booking successfully uses the coupon."""
    await mongodb.coupons().update_one({"code": code.upper()}, {"$inc": {"used_count": 1}})


async def release(code: str) -> None:
    """Give the usage back when a booking that used a coupon is cancelled."""
    await mongodb.coupons().update_one(
        {"code": code.upper(), "used_count": {"$gt": 0}}, {"$inc": {"used_count": -1}}
    )


async def create_coupon(payload: CouponCreate) -> dict[str, Any]:
    now = utcnow()
    document = {
        **payload.model_dump(),
        "discount_type": payload.discount_type.value,
        "used_count": 0,
        "created_at": now,
        "updated_at": now,
    }
    try:
        result = await mongodb.coupons().insert_one(document)
    except DuplicateKeyError:
        raise ConflictError("A coupon with this code already exists.")
    document["_id"] = result.inserted_id
    return serialize(document)


async def update_coupon(coupon_id: ObjectId, payload: CouponUpdate) -> dict[str, Any]:
    changes = payload.model_dump(exclude_unset=True)
    if "discount_type" in changes and changes["discount_type"] is not None:
        changes["discount_type"] = changes["discount_type"].value
    if changes:
        changes["updated_at"] = utcnow()
        result = await mongodb.coupons().update_one({"_id": coupon_id}, {"$set": changes})
        if result.matched_count == 0:
            raise NotFoundError("Coupon not found.")
    doc = await mongodb.coupons().find_one({"_id": coupon_id})
    if not doc:
        raise NotFoundError("Coupon not found.")
    return serialize(doc)


async def delete_coupon(coupon_id: ObjectId) -> None:
    result = await mongodb.coupons().delete_one({"_id": coupon_id})
    if result.deleted_count == 0:
        raise NotFoundError("Coupon not found.")


async def list_coupons(page: int, page_size: int, is_active: bool | None = None) -> dict[str, Any]:
    query: dict[str, Any] = {}
    if is_active is not None:
        query["is_active"] = is_active
    total = await mongodb.coupons().count_documents(query)
    cursor = (
        mongodb.coupons()
        .find(query)
        .sort("created_at", -1)
        .skip((page - 1) * page_size)
        .limit(page_size)
    )
    items = [serialize(doc) async for doc in cursor]
    return build_page(items, total, page, page_size)


async def list_public_offers(limit: int = 10) -> list[dict[str, Any]]:
    now = utcnow()
    cursor = (
        mongodb.coupons()
        .find({"is_active": True, "$or": [{"expires_at": None}, {"expires_at": {"$gte": now}}]})
        .sort("created_at", -1)
        .limit(limit)
    )
    offers = []
    async for doc in cursor:
        limit_value = doc.get("usage_limit")
        if limit_value is not None and doc.get("used_count", 0) >= limit_value:
            continue
        public = to_public(doc)
        public["expires_at"] = serialize(doc.get("expires_at"))
        offers.append(public)
    return offers
