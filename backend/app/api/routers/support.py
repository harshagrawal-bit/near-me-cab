"""/api/support — a deliberately small contact channel, not a ticketing system.

A submission is stored and raised as an in-app notification for every admin.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, status

from app.api.deps import AdminUser, CurrentUser, Pagination
from app.core.rate_limit import write_rate_limit
from app.db.mongodb import collection
from app.models.enums import NotificationType
from app.schemas.admin import SupportRequest
from app.schemas.common import build_page, serialize, utcnow
from app.services import notification_service, settings_service, user_service

router = APIRouter(prefix="/support", tags=["support"])

SUPPORT_COLLECTION = "support_requests"


@router.get("/contact", summary="How to reach the operations team")
async def contact(user: CurrentUser) -> dict:
    payload = await settings_service.get_public_settings()
    return payload["company"]


@router.post(
    "/requests",
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(write_rate_limit)],
    summary="Send a message to support",
)
async def create_request(payload: SupportRequest, user: CurrentUser) -> dict:
    now = utcnow()
    document = {
        "user_id": user["_id"],
        "user_name": user["name"],
        "user_role": user["role"],
        "subject": payload.subject,
        "message": payload.message,
        "booking_id": payload.booking_id,
        "contact_phone": payload.contact_phone or user.get("phone"),
        "contact_email": payload.contact_email or user.get("email"),
        "status": "open",
        "created_at": now,
        "updated_at": now,
    }
    result = await collection(SUPPORT_COLLECTION).insert_one(document)
    document["_id"] = result.inserted_id

    for admin_id in await user_service.get_admin_recipients():
        await notification_service.notify(
            user_id=admin_id,
            notification_type=NotificationType.SYSTEM,
            title=f"Support: {payload.subject}",
            body=f"{user['name']} needs help.",
            data={"support_request_id": str(result.inserted_id)},
        )
    return serialize(document)


@router.get("/requests", summary="My support messages")
async def my_requests(user: CurrentUser, page_params: Pagination) -> dict:
    query = {"user_id": user["_id"]}
    store = collection(SUPPORT_COLLECTION)
    total = await store.count_documents(query)
    cursor = (
        store.find(query)
        .sort("created_at", -1)
        .skip(page_params.skip)
        .limit(page_params.page_size)
    )
    items = [serialize(doc) async for doc in cursor]
    return build_page(items, total, page_params.page, page_params.page_size)


@router.get("/admin/requests", summary="All support messages (admin)")
async def all_requests(admin: AdminUser, page_params: Pagination) -> dict:
    store = collection(SUPPORT_COLLECTION)
    total = await store.count_documents({})
    cursor = (
        store.find({})
        .sort("created_at", -1)
        .skip(page_params.skip)
        .limit(page_params.page_size)
    )
    items = [serialize(doc) async for doc in cursor]
    return build_page(items, total, page_params.page, page_params.page_size)
