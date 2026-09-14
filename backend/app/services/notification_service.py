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

import httpx

from bson import ObjectId

from app.core.config import settings
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


#: Events worth interrupting someone for: a driver assigned, a booking
#: confirmed, a trip cancelled. Everything else stays in-app, because a cab
#: business that texts about everything gets its messages muted.
URGENT_CHANNELS: tuple[NotificationChannel, ...] = (
    NotificationChannel.IN_APP,
    NotificationChannel.WHATSAPP,
    NotificationChannel.SMS,
)


def to_e164(phone: str | None) -> str | None:
    """Normalise a stored number for a messaging provider.

    Numbers are held as ten digits locally; every provider wants E.164. A
    number that already carries a `+` is left alone, so an international
    customer is not silently given an Indian country code.
    """
    if not phone:
        return None
    cleaned = "".join(ch for ch in str(phone) if ch.isdigit() or ch == "+")
    if cleaned.startswith("+"):
        return cleaned
    return f"{settings.DEFAULT_COUNTRY_CODE}{cleaned.lstrip('0')}"


class WhatsAppAdapter:
    """WhatsApp via Meta's Cloud API.

    Note the 24-hour rule: free-form text is only deliverable within 24 hours
    of the customer's last message to you. Booking updates are proactive and
    therefore nearly always outside it, so a template name should be
    configured in production. Without one this falls back to plain text, which
    is fine in testing and will be rejected by Meta in the real world.
    """

    channel = NotificationChannel.WHATSAPP
    API_BASE = "https://graph.facebook.com/v21.0"

    def is_configured(self) -> bool:
        return bool(settings.WHATSAPP_PHONE_NUMBER_ID and settings.WHATSAPP_ACCESS_TOKEN)

    def _payload(self, to: str, title: str, body: str) -> dict[str, Any]:
        text = f"{title}\n\n{body}" if title else body
        if settings.WHATSAPP_TEMPLATE_NAME:
            return {
                "messaging_product": "whatsapp",
                "to": to,
                "type": "template",
                "template": {
                    "name": settings.WHATSAPP_TEMPLATE_NAME,
                    "language": {"code": settings.WHATSAPP_TEMPLATE_LANG},
                    "components": [
                        {
                            "type": "body",
                            "parameters": [{"type": "text", "text": text[:1000]}],
                        }
                    ],
                },
            }
        return {
            "messaging_product": "whatsapp",
            "to": to,
            "type": "text",
            "text": {"body": text[:4000]},
        }

    async def send(self, *, user: dict, title: str, body: str, data: dict) -> bool:
        to = to_e164(user.get("phone"))
        if not to:
            return False
        async with httpx.AsyncClient(timeout=15.0) as client:
            response = await client.post(
                f"{self.API_BASE}/{settings.WHATSAPP_PHONE_NUMBER_ID}/messages",
                json=self._payload(to, title, body),
                headers={"Authorization": f"Bearer {settings.WHATSAPP_ACCESS_TOKEN}"},
            )
        if response.status_code >= 400:
            # Never log the body: it echoes the recipient's number back.
            logger.warning("WhatsApp send failed (%s)", response.status_code)
            return False
        return True


class TwilioSmsAdapter:
    """SMS via Twilio.

    For Indian numbers a Twilio account is necessary but not sufficient: TRAI
    requires the sender id and every message template to be registered on a
    DLT platform through your operator first, or messages are dropped by the
    carrier rather than rejected by Twilio.
    """

    channel = NotificationChannel.SMS
    API_BASE = "https://api.twilio.com/2010-04-01"

    def is_configured(self) -> bool:
        return bool(
            settings.TWILIO_ACCOUNT_SID
            and settings.TWILIO_AUTH_TOKEN
            and settings.TWILIO_FROM_NUMBER
        )

    async def send(self, *, user: dict, title: str, body: str, data: dict) -> bool:
        to = to_e164(user.get("phone"))
        if not to:
            return False
        text = f"{title}: {body}" if title else body
        async with httpx.AsyncClient(timeout=15.0) as client:
            response = await client.post(
                f"{self.API_BASE}/Accounts/{settings.TWILIO_ACCOUNT_SID}/Messages.json",
                data={"To": to, "From": settings.TWILIO_FROM_NUMBER, "Body": text[:1500]},
                auth=(settings.TWILIO_ACCOUNT_SID, settings.TWILIO_AUTH_TOKEN),
            )
        if response.status_code >= 400:
            logger.warning("SMS send failed (%s)", response.status_code)
            return False
        return True


# Every adapter is registered; each reports for itself whether it is actually
# configured, so an unconfigured channel is recorded as `skipped` rather than
# pretending to have delivered.
_ADAPTERS: dict[NotificationChannel, NotificationChannelAdapter] = {
    NotificationChannel.IN_APP: InAppAdapter(),
    NotificationChannel.WHATSAPP: WhatsAppAdapter(),
    NotificationChannel.SMS: TwilioSmsAdapter(),
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

    # In-app delivery is the record itself and needs nothing more than the id.
    # Anything that has to reach a phone needs the phone, so load the user once
    # rather than per adapter.
    recipient: dict[str, Any] = {"_id": user_oid}
    if any(channel is not NotificationChannel.IN_APP for channel in channels):
        found = await mongodb.users().find_one(
            {"_id": user_oid}, {"name": 1, "phone": 1, "email": 1}
        )
        if found:
            recipient = found

    for channel in channels:
        adapter = _ADAPTERS.get(channel)
        if adapter is None or not adapter.is_configured():
            delivery[channel.value] = "skipped"
            continue
        try:
            ok = await adapter.send(user=recipient, title=title, body=body, data=payload)
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
