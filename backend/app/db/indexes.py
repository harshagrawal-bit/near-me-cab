"""Index definitions, applied idempotently on startup."""

from __future__ import annotations

import logging

from pymongo import ASCENDING, DESCENDING, TEXT
from pymongo.errors import OperationFailure

from app.db.mongodb import Collections, get_db

logger = logging.getLogger("localride.db")

INDEXES: dict[str, list[dict]] = {
    Collections.USERS: [
        {"keys": [("email", ASCENDING)], "unique": True, "name": "uniq_email"},
        # Partial, not plain, unique. A Google sign-up has no phone number yet,
        # and a plain unique index treats every missing phone as the same null —
        # so the second Google user to sign up would be rejected as a duplicate.
        {
            "keys": [("phone", ASCENDING)],
            "unique": True,
            "name": "uniq_phone",
            "partialFilterExpression": {"phone": {"$type": "string"}},
        },
        {"keys": [("role", ASCENDING), ("status", ASCENDING)], "name": "role_status"},
        {"keys": [("name", TEXT), ("email", TEXT), ("phone", TEXT)], "name": "user_search"},
    ],
    Collections.DRIVERS: [
        {"keys": [("user_id", ASCENDING)], "unique": True, "name": "uniq_user"},
        {"keys": [("verification_status", ASCENDING)], "name": "verification"},
        {"keys": [("is_available", ASCENDING), ("status", ASCENDING)], "name": "availability"},
        {"keys": [("assigned_vehicle_id", ASCENDING)], "name": "vehicle"},
    ],
    Collections.VEHICLES: [
        {"keys": [("registration_number", ASCENDING)], "unique": True, "name": "uniq_registration"},
        {"keys": [("vehicle_type", ASCENDING), ("status", ASCENDING)], "name": "type_status"},
        {"keys": [("assigned_driver_id", ASCENDING)], "name": "driver"},
    ],
    Collections.ROUTES: [
        {
            "keys": [("origin_key", ASCENDING), ("destination_key", ASCENDING)],
            "unique": True,
            "name": "uniq_origin_destination",
        },
        {"keys": [("is_active", ASCENDING)], "name": "active"},
        {"keys": [("name", TEXT), ("origin", TEXT), ("destination", TEXT)], "name": "route_search"},
    ],
    Collections.PRICING: [
        {
            "keys": [("route_id", ASCENDING), ("vehicle_type", ASCENDING)],
            "unique": True,
            "name": "uniq_route_vehicle",
        },
        {"keys": [("is_active", ASCENDING)], "name": "active"},
    ],
    Collections.BOOKINGS: [
        {"keys": [("booking_id", ASCENDING)], "unique": True, "name": "uniq_booking_id"},
        {"keys": [("customer_id", ASCENDING), ("created_at", DESCENDING)], "name": "customer_recent"},
        {"keys": [("driver_id", ASCENDING), ("scheduled_at", DESCENDING)], "name": "driver_schedule"},
        {"keys": [("status", ASCENDING), ("scheduled_at", ASCENDING)], "name": "status_schedule"},
        {"keys": [("payment_status", ASCENDING)], "name": "payment_status"},
        {"keys": [("route_id", ASCENDING)], "name": "route"},
        {"keys": [("vehicle_id", ASCENDING)], "name": "vehicle"},
        {"keys": [("created_at", DESCENDING)], "name": "recent"},
    ],
    Collections.BOOKING_STATUS_HISTORY: [
        {"keys": [("booking_id", ASCENDING), ("created_at", ASCENDING)], "name": "booking_timeline"},
    ],
    Collections.PAYMENTS: [
        {"keys": [("booking_id", ASCENDING)], "name": "booking"},
        {"keys": [("status", ASCENDING), ("created_at", DESCENDING)], "name": "status_recent"},
        # Defence in depth behind the intent compare-and-set: even if two
        # callers somehow both applied a gateway payment, the ledger physically
        # cannot hold the same provider reference twice. Partial, because
        # manually recorded payments legitimately have no reference.
        {
            "keys": [("provider", ASCENDING), ("provider_reference", ASCENDING)],
            "unique": True,
            "name": "uniq_provider_reference",
            "partialFilterExpression": {"provider_reference": {"$type": "string"}},
        },
    ],
    Collections.PAYMENT_INTENTS: [
        # The idempotency key. One order, one intent, enforced by the database
        # rather than by whichever request happens to arrive first.
        {"keys": [("order_id", ASCENDING)], "unique": True, "name": "uniq_order"},
        {"keys": [("user_id", ASCENDING), ("created_at", DESCENDING)], "name": "user_recent"},
        {"keys": [("status", ASCENDING)], "name": "status"},
    ],
    Collections.COUPONS: [
        {"keys": [("code", ASCENDING)], "unique": True, "name": "uniq_code"},
        {"keys": [("is_active", ASCENDING), ("expires_at", ASCENDING)], "name": "active_expiry"},
    ],
    Collections.REVIEWS: [
        {"keys": [("booking_id", ASCENDING)], "unique": True, "name": "uniq_booking"},
        {"keys": [("driver_id", ASCENDING), ("created_at", DESCENDING)], "name": "driver_recent"},
        {"keys": [("is_published", ASCENDING)], "name": "published"},
    ],
    Collections.NOTIFICATIONS: [
        {"keys": [("user_id", ASCENDING), ("created_at", DESCENDING)], "name": "user_recent"},
        {"keys": [("user_id", ASCENDING), ("is_read", ASCENDING)], "name": "user_unread"},
    ],
    Collections.ADMIN_SETTINGS: [
        {"keys": [("key", ASCENDING)], "unique": True, "name": "uniq_key"},
    ],
    Collections.WALLET_TRANSACTIONS: [
        {"keys": [("driver_id", ASCENDING), ("created_at", DESCENDING)], "name": "driver_recent"},
        {"keys": [("booking_id", ASCENDING)], "name": "booking"},
        # A live HOLD must be found and released exactly once when a trip ends.
        {"keys": [("driver_id", ASCENDING), ("type", ASCENDING), ("is_open", ASCENDING)],
         "name": "open_holds"},
    ],
}


async def ensure_indexes() -> None:
    db = get_db()
    for collection_name, specs in INDEXES.items():
        for spec in specs:
            options: dict = {"name": spec["name"], "unique": spec.get("unique", False)}
            if "partialFilterExpression" in spec:
                options["partialFilterExpression"] = spec["partialFilterExpression"]
            try:
                await db[collection_name].create_index(spec["keys"], **options)
            except OperationFailure as exc:  # pragma: no cover - depends on pre-existing state
                logger.warning(
                    "Could not create index %s on %s: %s", spec["name"], collection_name, exc
                )
    logger.info("Indexes ensured for %d collections", len(INDEXES))
