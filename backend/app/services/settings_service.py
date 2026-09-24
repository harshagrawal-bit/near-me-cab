"""Global admin settings — a single document that other services read from."""

from __future__ import annotations

from typing import Any

from app.db import mongodb
from app.schemas.admin import SettingsPayload, SettingsUpdate
from app.schemas.common import serialize, utcnow

SETTINGS_KEY = "global"


async def get_settings_doc() -> dict[str, Any]:
    doc = await mongodb.admin_settings().find_one({"key": SETTINGS_KEY})
    if not doc:
        defaults = SettingsPayload().model_dump()
        doc = {
            "key": SETTINGS_KEY,
            **defaults,
            "created_at": utcnow(),
            "updated_at": utcnow(),
        }
        await mongodb.admin_settings().update_one(
            {"key": SETTINGS_KEY}, {"$setOnInsert": doc}, upsert=True
        )
        doc = await mongodb.admin_settings().find_one({"key": SETTINGS_KEY})
    return doc or {}


async def get_settings() -> SettingsPayload:
    doc = await get_settings_doc()
    return SettingsPayload(
        company=doc.get("company") or {},
        pricing=doc.get("pricing") or {},
        booking=doc.get("booking") or {},
        # Sections added after the first release: documents seeded before they
        # existed have no key, so fall back to the schema defaults rather than
        # forcing a migration.
        advance=doc.get("advance") or {},
        wallet=doc.get("wallet") or {},
        cancellation=doc.get("cancellation") or {},
        payment_options=doc.get("payment_options") or {},
        privacy=doc.get("privacy") or {},
    )


async def get_public_settings() -> dict[str, Any]:
    """Non-sensitive settings safe to expose to any authenticated user."""
    payload = await get_settings()
    return {
        "company": payload.company.model_dump(),
        "pricing": {
            "currency": payload.pricing.currency,
            "free_cancellation_hours": payload.pricing.free_cancellation_hours,
            "cancellation_fee_percent": payload.pricing.cancellation_fee_percent,
        },
        "booking": payload.booking.model_dump(),
        # Customers need to know the advance rule before they book; the wallet
        # rule is what a driver is held to. Neither is a secret — but both are
        # read-only here, and only the server ever applies them.
        "advance": payload.advance.model_dump(),
        "wallet": payload.wallet.model_dump(),
        # Customers must be able to see the cancellation rule and their payment
        # choices before they commit, not discover them afterwards.
        "cancellation": payload.cancellation.model_dump(),
        "payment_options": payload.payment_options.model_dump(),
        "privacy": payload.privacy.model_dump(),
    }


async def update_settings(update: SettingsUpdate) -> dict[str, Any]:
    """Merge the sections a caller actually sent into the stored document.

    The merge is per *field*, not per section. Each section model carries a
    default for every field, so `model_dump()` of `{"wallet": {"min_balance":
    1500}}` is a complete WalletSettings with every other field silently reset
    to its default — saving one knob from a form would quietly wipe the rest of
    that group. `exclude_unset` keeps only what the caller named, and the stored
    values fill the gaps.
    """
    current = await get_settings_doc()
    changes: dict[str, Any] = {"updated_at": utcnow()}
    for section in (
        "company",
        "pricing",
        "booking",
        "advance",
        "wallet",
        "cancellation",
        "payment_options",
        "privacy",
    ):
        value = getattr(update, section)
        if value is None:
            continue
        merged = dict(current.get(section) or {})
        merged.update(value.model_dump(exclude_unset=True))
        changes[section] = merged
    await mongodb.admin_settings().update_one({"key": SETTINGS_KEY}, {"$set": changes})
    doc = await get_settings_doc()
    return serialize(doc)
