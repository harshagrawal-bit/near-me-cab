"""Authentication and role-based authorisation, exercised over real HTTP."""

from __future__ import annotations

import pytest

from tests.conftest import auth

pytestmark = pytest.mark.asyncio(loop_scope="session")


async def test_health(client):
    response = await client.get("/api/health")
    assert response.status_code == 200
    assert response.json()["database"] == "ok"


async def test_login_returns_token_and_public_user(client, seeded):
    response = await client.post(
        "/api/auth/login", json={"email": "customer@localride-test.com", "password": "Password@123"}
    )
    assert response.status_code == 200
    body = response.json()
    assert body["user"]["role"] == "customer"
    assert "password_hash" not in response.text


async def test_wrong_password_and_unknown_user_are_indistinguishable(client, seeded):
    wrong = await client.post(
        "/api/auth/login", json={"email": "customer@localride-test.com", "password": "Nope@12345"}
    )
    unknown = await client.post(
        "/api/auth/login", json={"email": "ghost@localride-test.com", "password": "Nope@12345"}
    )
    assert wrong.status_code == unknown.status_code == 401
    assert wrong.json()["detail"] == unknown.json()["detail"]


async def test_registration_always_creates_a_customer(client):
    """A caller must not be able to self-assign a privileged role."""
    response = await client.post(
        "/api/auth/register",
        json={
            "name": "Role Escalation",
            "email": "escalate@localride-test.com",
            "phone": "9000000123",
            "password": "Str0ng@pass",
            "role": "admin",
        },
    )
    # `role` is not an accepted field — the schema rejects unknown input.
    assert response.status_code == 422

    clean = await client.post(
        "/api/auth/register",
        json={
            "name": "Ordinary Customer",
            "email": "ordinary@localride-test.com",
            "phone": "9000000124",
            "password": "Str0ng@pass",
        },
    )
    assert clean.status_code == 201
    assert clean.json()["user"]["role"] == "customer"


@pytest.mark.parametrize("password", ["short", "12345678", "abcdefgh"])
async def test_weak_passwords_rejected(client, password):
    response = await client.post(
        "/api/auth/register",
        json={
            "name": "Weak Password",
            "email": f"weak-{password}@localride-test.com",
            "phone": "9000000125",
            "password": password,
        },
    )
    assert response.status_code == 422


@pytest.mark.parametrize("phone", ["12345", "1234567890", "abcdefghij", "+1 555 010 9999"])
async def test_invalid_phone_rejected(client, phone):
    response = await client.post(
        "/api/auth/register",
        json={
            "name": "Bad Phone",
            "email": f"badphone-{abs(hash(phone))}@localride-test.com",
            "phone": phone,
            "password": "Str0ng@pass",
        },
    )
    assert response.status_code == 422


@pytest.mark.parametrize(
    "path",
    ["/api/users/me", "/api/bookings", "/api/admin/dashboard", "/api/drivers", "/api/vehicles"],
)
async def test_endpoints_require_authentication(client, path):
    assert (await client.get(path)).status_code == 401


async def test_malformed_token_rejected(client):
    response = await client.get("/api/users/me", headers={"Authorization": "Bearer not-a-jwt"})
    assert response.status_code == 401


@pytest.mark.parametrize(
    "path",
    [
        "/api/admin/dashboard",
        "/api/admin/customers",
        "/api/admin/reports",
        "/api/admin/settings",
        "/api/drivers",
        "/api/vehicles",
        "/api/pricing",
        "/api/payments",
        "/api/coupons",
    ],
)
async def test_customer_cannot_reach_admin_endpoints(client, customer_token, path):
    response = await client.get(path, headers=auth(customer_token))
    assert response.status_code == 403


async def test_customer_cannot_write_admin_resources(client, customer_token):
    for method, path, payload in (
        ("post", "/api/routes", {"origin": "A", "destination": "B", "distance_km": 1, "duration_minutes": 1}),
        ("post", "/api/vehicles", {"vehicle_type": "sedan", "model": "X", "registration_number": "XX11XX1111", "seating_capacity": 4}),
        ("post", "/api/coupons", {"code": "NOPE", "discount_type": "flat", "discount_value": 10}),
    ):
        response = await getattr(client, method)(path, json=payload, headers=auth(customer_token))
        assert response.status_code == 403, f"{path} was not protected"


async def test_admin_cannot_use_driver_only_endpoints(client, admin_token):
    response = await client.get("/api/drivers/me", headers=auth(admin_token))
    assert response.status_code == 403


async def test_suspended_account_cannot_sign_in(client, admin_token, seeded):
    customer_id = str(seeded["customer"]["_id"])
    await client.post(
        f"/api/admin/customers/{customer_id}/suspend",
        json={"suspended": True, "reason": "Testing"},
        headers=auth(admin_token),
    )
    blocked = await client.post(
        "/api/auth/login", json={"email": "customer@localride-test.com", "password": "Password@123"}
    )
    assert blocked.status_code == 403

    await client.post(
        f"/api/admin/customers/{customer_id}/suspend",
        json={"suspended": False},
        headers=auth(admin_token),
    )
    restored = await client.post(
        "/api/auth/login", json={"email": "customer@localride-test.com", "password": "Password@123"}
    )
    assert restored.status_code == 200


async def test_invalid_object_id_returns_422_not_500(client, admin_token):
    response = await client.get("/api/bookings/not-a-valid-id", headers=auth(admin_token))
    assert response.status_code == 422


async def test_unknown_booking_returns_404(client, admin_token):
    response = await client.get(
        "/api/bookings/000000000000000000000000", headers=auth(admin_token)
    )
    assert response.status_code == 404


async def test_error_responses_never_leak_internals(client):
    response = await client.get("/api/users/me")
    body = response.text.lower()
    assert "traceback" not in body
    assert "mongodb" not in body
    assert response.json()["code"] == "unauthorized"
