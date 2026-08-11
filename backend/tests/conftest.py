"""Pytest fixtures.

Tests run against a real MongoDB instance but in a throwaway database, so
nothing touches development data. Set `TEST_MONGODB_URI` to point at a
different server.
"""

from __future__ import annotations

import os
import uuid

import pytest
import pytest_asyncio
from asgi_lifespan import LifespanManager
from httpx import ASGITransport, AsyncClient

os.environ.setdefault("ENV", "test")
os.environ.setdefault("RATE_LIMIT_ENABLED", "false")
os.environ.setdefault("JWT_SECRET", "test-secret-not-used-in-production-000000")

TEST_DB_NAME = f"localride_test_{uuid.uuid4().hex[:8]}"
os.environ["MONGODB_DB_NAME"] = TEST_DB_NAME
os.environ.setdefault(
    "MONGODB_URI", os.environ.get("TEST_MONGODB_URI", "mongodb://127.0.0.1:27017")
)

from app.core.config import get_settings  # noqa: E402

get_settings.cache_clear()

from app.core.config import settings  # noqa: E402
from app.main import create_app  # noqa: E402


@pytest.fixture(scope="session")
def anyio_backend():
    return "asyncio"


@pytest_asyncio.fixture(scope="session", loop_scope="session")
async def app():
    application = create_app()
    async with LifespanManager(application):
        yield application
    # Drop the throwaway database once the suite finishes.
    from motor.motor_asyncio import AsyncIOMotorClient

    client = AsyncIOMotorClient(settings.MONGODB_URI)
    await client.drop_database(TEST_DB_NAME)
    client.close()


@pytest_asyncio.fixture(loop_scope="session")
async def client(app):
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as http:
        yield http


@pytest_asyncio.fixture(loop_scope="session")
async def seeded(app):
    """Minimal reference data: an admin, a customer, a route and its prices."""
    from app.core.security import hash_password
    from app.db import mongodb
    from app.models.enums import AccountStatus, Role, VehicleType
    from app.schemas.common import utcnow
    from app.services.route_service import default_name, place_key

    async def make_user(name, email, phone, role, password="Password@123"):
        existing = await mongodb.users().find_one({"email": email})
        if existing:
            return existing
        doc = {
            "name": name,
            "email": email,
            "phone": phone,
            "password_hash": hash_password(password),
            "role": role.value,
            "status": AccountStatus.ACTIVE.value,
            "avatar_url": None,
            "saved_locations": [],
            "created_at": utcnow(),
            "updated_at": utcnow(),
            "last_login_at": None,
        }
        result = await mongodb.users().insert_one(doc)
        doc["_id"] = result.inserted_id
        return doc

    admin = await make_user("Test Admin", "admin@localride-test.com", "9000000001", Role.ADMIN)
    customer = await make_user("Test Customer", "customer@localride-test.com", "9000000002", Role.CUSTOMER)

    route = await mongodb.routes().find_one({"origin_key": place_key("Pune")})
    if not route:
        doc = {
            "origin": "Pune",
            "destination": "Mumbai",
            "origin_key": place_key("Pune"),
            "destination_key": place_key("Mumbai"),
            "name": default_name("Pune", "Mumbai"),
            "distance_km": 150.0,
            "duration_minutes": 210,
            "is_active": True,
            "created_at": utcnow(),
            "updated_at": utcnow(),
        }
        result = await mongodb.routes().insert_one(doc)
        doc["_id"] = result.inserted_id
        route = doc

    for vehicle_type, fare in (
        (VehicleType.SEDAN, 3000.0),
        (VehicleType.SUV, 4000.0),
    ):
        await mongodb.pricing().update_one(
            {"route_id": route["_id"], "vehicle_type": vehicle_type.value},
            {
                "$set": {
                    "route_id": route["_id"],
                    "vehicle_type": vehicle_type.value,
                    "fixed_fare": fare,
                    "base_fare": 0.0,
                    "per_km_rate": 0.0,
                    "driver_allowance": 0.0,
                    "toll": 0.0,
                    "night_surcharge": 250.0,
                    "airport_surcharge": 0.0,
                    "additional_charges": 0.0,
                    "is_active": True,
                    "updated_at": utcnow(),
                },
                "$setOnInsert": {"created_at": utcnow()},
            },
            upsert=True,
        )

    return {"admin": admin, "customer": customer, "route": route}


@pytest_asyncio.fixture(loop_scope="session")
async def customer_token(client, seeded):
    response = await client.post(
        "/api/auth/login",
        json={"email": "customer@localride-test.com", "password": "Password@123"},
    )
    return response.json()["access_token"]


@pytest_asyncio.fixture(loop_scope="session")
async def admin_token(client, seeded):
    response = await client.post(
        "/api/auth/login", json={"email": "admin@localride-test.com", "password": "Password@123"}
    )
    return response.json()["access_token"]


def auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}
