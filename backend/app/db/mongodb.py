"""Mongo connection lifecycle and collection accessors."""

from __future__ import annotations

import logging

from motor.motor_asyncio import AsyncIOMotorClient, AsyncIOMotorCollection, AsyncIOMotorDatabase

from app.core.config import settings

logger = logging.getLogger("localride.db")


class Database:
    client: AsyncIOMotorClient | None = None
    db: AsyncIOMotorDatabase | None = None


_state = Database()


async def connect_to_mongo(uri: str | None = None, db_name: str | None = None) -> AsyncIOMotorDatabase:
    _state.client = AsyncIOMotorClient(
        uri or settings.MONGODB_URI,
        serverSelectionTimeoutMS=5000,
        uuidRepresentation="standard",
    )
    _state.db = _state.client[db_name or settings.MONGODB_DB_NAME]
    await _state.client.admin.command("ping")
    logger.info("Connected to MongoDB database '%s'", _state.db.name)
    return _state.db


async def close_mongo_connection() -> None:
    if _state.client is not None:
        _state.client.close()
        _state.client = None
        _state.db = None
        logger.info("MongoDB connection closed")


def get_db() -> AsyncIOMotorDatabase:
    if _state.db is None:
        raise RuntimeError("Database is not initialised. Did the app lifespan run?")
    return _state.db


class Collections:
    USERS = "users"
    DRIVERS = "drivers"
    VEHICLES = "vehicles"
    ROUTES = "routes"
    PRICING = "pricing"
    BOOKINGS = "bookings"
    BOOKING_STATUS_HISTORY = "booking_status_history"
    PAYMENTS = "payments"
    COUPONS = "coupons"
    REVIEWS = "reviews"
    NOTIFICATIONS = "notifications"
    ADMIN_SETTINGS = "admin_settings"
    COUNTERS = "counters"
    WALLET_TRANSACTIONS = "wallet_transactions"
    PAYMENT_INTENTS = "payment_intents"
    WITHDRAWAL_REQUESTS = "withdrawal_requests"


def collection(name: str) -> AsyncIOMotorCollection:
    return get_db()[name]


# Convenience accessors used across services.
def users() -> AsyncIOMotorCollection:
    return collection(Collections.USERS)


def drivers() -> AsyncIOMotorCollection:
    return collection(Collections.DRIVERS)


def vehicles() -> AsyncIOMotorCollection:
    return collection(Collections.VEHICLES)


def routes() -> AsyncIOMotorCollection:
    return collection(Collections.ROUTES)


def pricing() -> AsyncIOMotorCollection:
    return collection(Collections.PRICING)


def bookings() -> AsyncIOMotorCollection:
    return collection(Collections.BOOKINGS)


def booking_status_history() -> AsyncIOMotorCollection:
    return collection(Collections.BOOKING_STATUS_HISTORY)


def payments() -> AsyncIOMotorCollection:
    return collection(Collections.PAYMENTS)


def coupons() -> AsyncIOMotorCollection:
    return collection(Collections.COUPONS)


def reviews() -> AsyncIOMotorCollection:
    return collection(Collections.REVIEWS)


def notifications() -> AsyncIOMotorCollection:
    return collection(Collections.NOTIFICATIONS)


def admin_settings() -> AsyncIOMotorCollection:
    return collection(Collections.ADMIN_SETTINGS)


def counters() -> AsyncIOMotorCollection:
    return collection(Collections.COUNTERS)


def wallet_transactions() -> AsyncIOMotorCollection:
    return collection(Collections.WALLET_TRANSACTIONS)


def payment_intents() -> AsyncIOMotorCollection:
    return collection(Collections.PAYMENT_INTENTS)


def withdrawal_requests() -> AsyncIOMotorCollection:
    return collection(Collections.WITHDRAWAL_REQUESTS)
