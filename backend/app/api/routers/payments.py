"""/api/payments — the payment ledger.

Deliberately provider-agnostic. `provider` is stored on every record so a
Razorpay (or any other gateway) integration can be added as a new provider
adapter plus a webhook route, without changing this collection's shape.
"""

from __future__ import annotations

from fastapi import APIRouter, Query

from app.api.deps import AdminUser, CurrentUser, Pagination
from app.db import mongodb
from app.models.enums import PaymentStatus, Role
from app.schemas.common import build_page, object_id, serialize

router = APIRouter(prefix="/payments", tags=["payments"])


@router.get("", summary="Payment records (admin)")
async def list_payments(
    admin: AdminUser,
    page_params: Pagination,
    status_filter: str | None = Query(None, alias="status"),
    search: str | None = Query(None, max_length=60),
) -> dict:
    query: dict = {}
    if status_filter:
        query["status"] = status_filter
    if search:
        query["booking_reference"] = {"$regex": search.strip(), "$options": "i"}

    total = await mongodb.payments().count_documents(query)
    cursor = (
        mongodb.payments()
        .find(query)
        .sort("created_at", -1)
        .skip(page_params.skip)
        .limit(page_params.page_size)
    )
    items = []
    async for doc in cursor:
        item = serialize(doc)
        customer = await mongodb.users().find_one({"_id": doc["customer_id"]}, {"name": 1})
        item["customer_name"] = customer["name"] if customer else None
        items.append(item)
    return build_page(items, total, page_params.page, page_params.page_size)


@router.get("/methods", summary="Payment methods this deployment supports")
async def methods(user: CurrentUser) -> dict:
    """Only cash and manual reconciliation are actually wired up today."""
    return {
        "online_enabled": False,
        "providers": [{"id": "manual", "label": "Recorded by operations", "enabled": True}],
        "methods": [
            {"id": "cash", "label": "Pay driver in cash", "enabled": True},
            {"id": "upi", "label": "UPI (record manually)", "enabled": True},
        ],
        "statuses": [status.value for status in PaymentStatus],
    }


@router.get("/booking/{booking_id}", summary="Payments for one booking")
async def payments_for_booking(booking_id: str, user: CurrentUser) -> list[dict]:
    booking_oid = object_id(booking_id, "booking_id")
    booking = await mongodb.bookings().find_one({"_id": booking_oid}, {"customer_id": 1})
    if not booking:
        return []
    if user["role"] == Role.CUSTOMER.value and booking["customer_id"] != user["_id"]:
        return []
    if user["role"] == Role.DRIVER.value:
        return []
    cursor = mongodb.payments().find({"booking_id": booking_oid}).sort("created_at", -1)
    return [serialize(doc) async for doc in cursor]
