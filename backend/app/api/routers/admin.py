"""/api/admin — dashboard, customer directory, reports and settings."""

from __future__ import annotations

import datetime as dt

from fastapi import APIRouter, Query

from app.api.deps import AdminUser, Pagination
from app.models.enums import AccountStatus
from app.schemas.admin import SettingsUpdate, SuspendRequest
from app.schemas.common import object_id
from app.services import (
    booking_service,
    customer_service,
    report_service,
    settings_service,
    user_service,
)

router = APIRouter(prefix="/admin", tags=["admin"])


@router.get("/dashboard", summary="Operations dashboard")
async def dashboard(admin: AdminUser) -> dict:
    return await report_service.dashboard_summary()


@router.get("/reports", summary="Date-filtered reports")
async def reports(
    admin: AdminUser,
    date_from: dt.datetime | None = Query(None),
    date_to: dt.datetime | None = Query(None),
) -> dict:
    return await report_service.reports(date_from, date_to)


# ---------------------------------------------------------------------------
# Customers
# ---------------------------------------------------------------------------


@router.get("/customers", summary="Customer directory")
async def list_customers(
    admin: AdminUser,
    page_params: Pagination,
    search: str | None = Query(None, max_length=60),
    status: str | None = Query(None),
) -> dict:
    return await customer_service.list_customers(
        page_params.page, page_params.page_size, search=search, status=status
    )


@router.get("/customers/{customer_id}", summary="Customer profile")
async def customer_detail(customer_id: str, admin: AdminUser) -> dict:
    return await customer_service.customer_detail(object_id(customer_id, "customer_id"))


@router.get("/customers/{customer_id}/bookings", summary="A customer's booking history")
async def customer_bookings(customer_id: str, admin: AdminUser, page_params: Pagination) -> dict:
    return await booking_service.list_bookings(
        page_params.page,
        page_params.page_size,
        extra_query={"customer_id": object_id(customer_id, "customer_id")},
    )


@router.post("/customers/{customer_id}/suspend", summary="Suspend or restore an account")
async def suspend_customer(customer_id: str, payload: SuspendRequest, admin: AdminUser) -> dict:
    target = AccountStatus.SUSPENDED if payload.suspended else AccountStatus.ACTIVE
    user = await user_service.set_status(
        object_id(customer_id, "customer_id"), target, payload.reason
    )
    return user_service.to_public(user)


# ---------------------------------------------------------------------------
# Settings
# ---------------------------------------------------------------------------


@router.get("/settings", summary="Read global settings")
async def get_settings(admin: AdminUser) -> dict:
    payload = await settings_service.get_settings()
    return payload.model_dump()


@router.patch("/settings", summary="Update global settings")
async def update_settings(payload: SettingsUpdate, admin: AdminUser) -> dict:
    await settings_service.update_settings(payload)
    updated = await settings_service.get_settings()
    return updated.model_dump()
