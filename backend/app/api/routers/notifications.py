"""/api/notifications — in-app notification inbox."""

from __future__ import annotations

from fastapi import APIRouter, Query

from app.api.deps import CurrentUser, Pagination
from app.core.errors import NotFoundError
from app.schemas.common import Message, object_id
from app.services import notification_service

router = APIRouter(prefix="/notifications", tags=["notifications"])


@router.get("", summary="My notifications")
async def list_notifications(
    user: CurrentUser, page_params: Pagination, unread_only: bool = Query(False)
) -> dict:
    return await notification_service.list_for_user(
        user["_id"], page_params.page, page_params.page_size, unread_only
    )


@router.get("/unread-count", summary="Unread notification count")
async def unread_count(user: CurrentUser) -> dict:
    return {
        "count": await notification_service.unread_count(user["_id"]),
        "channels": notification_service.available_channels(),
    }


@router.post("/{notification_id}/read", response_model=Message, summary="Mark one as read")
async def mark_read(notification_id: str, user: CurrentUser) -> Message:
    ok = await notification_service.mark_read(
        user["_id"], object_id(notification_id, "notification_id")
    )
    if not ok:
        raise NotFoundError("Notification not found.")
    return Message(detail="Marked as read.")


@router.post("/read-all", response_model=Message, summary="Mark everything as read")
async def mark_all_read(user: CurrentUser) -> Message:
    count = await notification_service.mark_all_read(user["_id"])
    return Message(detail=f"{count} notifications marked as read.")
