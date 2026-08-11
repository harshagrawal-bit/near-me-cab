"""Notification abstraction.

Every notification is persisted as a database record and surfaced in-app. The
`Channel` dispatch table is where Firebase / SMS / email / WhatsApp providers
plug in later — each becomes a `NotificationChannelAdapter`. Nothing here
pretends to deliver over a channel that is not actually wired up: adapters
that are not configured are recorded as `skipped` on the notification record.
"""

from __future__ import annotations

import logging
from typing import Any, Iterable, Protocol

from bson import ObjectId

from app.db import mongodb
from app.models.enums import NotificationChannel, NotificationType
from app.schemas.common import build_page, serialize, utcnow

logger = logging.getLogger("localride.notifications")


class NotificationChannelAdapter(Protocol):
    """Contract for a delivery channel."""

    channel: NotificationChannel

    def is_configured(self) -> bool: ...

    async def send(self, *, user: dict, title: str, body: str, data: dict) -> bool: ...


class InAppAdapter:
    """Always available — the record itself is the delivery."""

    channel = NotificationChannel.IN_APP

    def is_configured(self) -> bool:
        return True

    async def send(self, *, user: dict, title: str, body: str, data: dict) -> bool:
        return True


# Register additional adapters here once their providers are implemented.
_ADAPTERS: dict[NotificationChannel, NotificationChannelAdapter] = {
    NotificationChannel.IN_APP: InAppAdapter(),
}


def available_channels() -> list[str]:
    return [channel.value for channel, adapter in _ADAPTERS.items() if adapter.is_configured()]


async def notify(
    *,
    user_id: ObjectId | str,
    notification_type: NotificationType,
    title: str,
    body: str,
    booking_id: ObjectId | str | None = None,
    data: dict[str, Any] | None = None,
    channels: Iterable[NotificationChannel] = (NotificationChannel.IN_APP,),
) -> dict[str, Any]:
    """Create a notification record and attempt delivery on each channel."""
    delivery: dict[str, str] = {}
    user_oid = ObjectId(str(user_id))
    payload = data or {}

    for channel in channels:
        adapter = _ADAPTERS.get(channel)
        if adapter is None or not adapter.is_configured():
            delivery[channel.value] = "skipped"
            continue
        try:
            ok = await adapter.send(user={"_id": user_oid}, title=title, body=body, data=payload)
            delivery[channel.value] = "sent" if ok else "failed"
        except Exception:  # pragma: no cover - adapter specific
            logger.exception("Notification channel %s failed", channel.value)
            delivery[channel.value] = "failed"

    document = {
        "user_id": user_oid,
        "type": notification_type.value,
        "title": title,
        "body": body,
        "booking_id": ObjectId(str(booking_id)) if booking_id else None,
        "data": payload,
        "delivery": delivery,
        "is_read": False,
        "created_at": utcnow(),
    }
    result = await mongodb.notifications().insert_one(document)
    document["_id"] = result.inserted_id
    return serialize(document)


async def notify_many(user_ids: Iterable[ObjectId | str], **kwargs) -> None:
    for user_id in user_ids:
        await notify(user_id=user_id, **kwargs)


async def list_for_user(user_id: ObjectId, page: int, page_size: int, unread_only: bool = False):
    query: dict[str, Any] = {"user_id": user_id}
    if unread_only:
        query["is_read"] = False
    total = await mongodb.notifications().count_documents(query)
    cursor = (
        mongodb.notifications()
        .find(query)
        .sort("created_at", -1)
        .skip((page - 1) * page_size)
        .limit(page_size)
    )
    items = [serialize(doc) async for doc in cursor]
    return build_page(items, total, page, page_size)


async def unread_count(user_id: ObjectId) -> int:
    return await mongodb.notifications().count_documents({"user_id": user_id, "is_read": False})


async def mark_read(user_id: ObjectId, notification_id: ObjectId) -> bool:
    result = await mongodb.notifications().update_one(
        {"_id": notification_id, "user_id": user_id}, {"$set": {"is_read": True}}
    )
    return result.matched_count > 0


async def mark_all_read(user_id: ObjectId) -> int:
    result = await mongodb.notifications().update_many(
        {"user_id": user_id, "is_read": False}, {"$set": {"is_read": True}}
    )
    return result.modified_count
