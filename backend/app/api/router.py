"""Aggregates every versioned router under the API prefix."""

from __future__ import annotations

from fastapi import APIRouter

from app.api.routers import (
    admin,
    auth,
    bookings,
    coupons,
    drivers,
    fleet,
    legal,
    notifications,
    payments,
    pricing,
    reviews,
    routes,
    support,
    users,
    vehicles,
)

api_router = APIRouter()

for module in (
    auth,
    users,
    routes,
    pricing,
    vehicles,
    drivers,
    fleet,
    legal,
    bookings,
    payments,
    coupons,
    reviews,
    notifications,
    support,
    admin,
):
    api_router.include_router(module.router)
