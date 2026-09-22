"""/api/drivers — the driver's own workspace plus admin driver management."""

from __future__ import annotations

import datetime as dt

from fastapi import APIRouter, Depends, Query, status

from app.api.deps import AdminUser, CurrentDriver, DriverUser, Pagination
from app.core.rate_limit import write_rate_limit
from app.db import mongodb
from app.core.errors import ValidationError
from app.models.enums import ACTIVE_BOOKING_STATUSES, BookingStatus, WalletTxnType
from app.schemas.common import Message, object_id, serialize, utcnow
from app.schemas.fleet import AvailabilityUpdate, DriverCreate, DriverSelfUpdate, DriverUpdate
from app.schemas.wallet import WalletAdjustment, WalletTopUp
from app.services import booking_service, driver_service, wallet_service

router = APIRouter(prefix="/drivers", tags=["drivers"])


# ---------------------------------------------------------------------------
# Driver self-service
# ---------------------------------------------------------------------------


@router.get("/me", summary="My driver profile")
async def my_profile(driver: CurrentDriver) -> dict:
    return await driver_service.require_driver(driver["_id"])


@router.patch("/me", summary="Update my profile")
async def update_my_profile(payload: DriverSelfUpdate, driver: CurrentDriver) -> dict:
    return await driver_service.update_own_profile(driver["_id"], payload)


@router.post(
    "/me/availability",
    dependencies=[Depends(write_rate_limit)],
    summary="Go online or offline",
)
async def set_availability(payload: AvailabilityUpdate, driver: CurrentDriver) -> dict:
    return await driver_service.set_availability(driver["_id"], payload.is_available)


@router.get("/me/documents", summary="My documents and their status")
async def my_documents(driver: CurrentDriver) -> dict:
    profile = await driver_service.require_driver(driver["_id"])
    return {
        "documents": profile.get("documents", []),
        "verification_status": profile.get("verification_status"),
        "licence_number": profile.get("licence_number"),
        "licence_expiry": profile.get("licence_expiry"),
    }


@router.get("/me/earnings", summary="My earnings summary")
async def my_earnings(driver: CurrentDriver) -> dict:
    return await driver_service.earnings_summary(driver["_id"])


@router.get("/me/dashboard", summary="Driver home screen data")
async def my_dashboard(driver: CurrentDriver) -> dict:
    profile = await driver_service.require_driver(driver["_id"])
    earnings = await driver_service.earnings_summary(driver["_id"])

    start_of_day = utcnow().replace(hour=0, minute=0, second=0, microsecond=0)
    end_of_day = start_of_day + dt.timedelta(days=1)

    todays_cursor = (
        mongodb.bookings()
        .find(
            {
                "driver_id": driver["_id"],
                "scheduled_at": {"$gte": start_of_day, "$lt": end_of_day},
                "status": {"$ne": BookingStatus.CANCELLED.value},
            }
        )
        .sort("scheduled_at", 1)
    )
    todays_trips = [await booking_service.hydrate(doc) async for doc in todays_cursor]

    current = await mongodb.bookings().find_one(
        {"driver_id": driver["_id"], "status": {"$in": list(ACTIVE_BOOKING_STATUSES)}},
        sort=[("scheduled_at", 1)],
    )
    upcoming_cursor = (
        mongodb.bookings()
        .find(
            {
                "driver_id": driver["_id"],
                "scheduled_at": {"$gte": utcnow()},
                "status": {
                    "$nin": [BookingStatus.CANCELLED.value, BookingStatus.COMPLETED.value]
                },
            }
        )
        .sort("scheduled_at", 1)
        .limit(5)
    )

    return {
        "driver": profile,
        "earnings": earnings,
        "todays_trips": todays_trips,
        "current_trip": await booking_service.hydrate(current, include_history=True)
        if current
        else None,
        "upcoming_trips": [await booking_service.hydrate(doc) async for doc in upcoming_cursor],
    }


# ---------------------------------------------------------------------------
# Admin driver management
# ---------------------------------------------------------------------------


@router.get("", summary="List drivers (admin)")
async def list_drivers(
    admin: AdminUser,
    page_params: Pagination,
    search: str | None = Query(None, max_length=60),
    status_filter: str | None = Query(None, alias="status"),
    verification_status: str | None = Query(None),
    is_available: bool | None = Query(None),
) -> dict:
    return await driver_service.list_drivers(
        page_params.page,
        page_params.page_size,
        search=search,
        status=status_filter,
        verification_status=verification_status,
        is_available=is_available,
    )


@router.get("/assignable", summary="Drivers eligible for assignment (admin)")
async def assignable(admin: AdminUser, vehicle_type: str | None = Query(None)) -> list[dict]:
    return await driver_service.assignable_drivers(vehicle_type)


@router.post(
    "",
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(write_rate_limit)],
    summary="Add a driver (admin)",
)
async def create_driver(payload: DriverCreate, admin: AdminUser) -> dict:
    return await driver_service.create_driver(payload)


@router.get("/{driver_id}", summary="Driver detail (admin)")
async def get_driver(driver_id: str, admin: AdminUser) -> dict:
    return await driver_service.require_driver(object_id(driver_id, "driver_id"))


@router.patch("/{driver_id}", summary="Edit a driver (admin)")
async def update_driver(driver_id: str, payload: DriverUpdate, admin: AdminUser) -> dict:
    return await driver_service.update_driver(object_id(driver_id, "driver_id"), payload)


@router.get("/{driver_id}/bookings", summary="A driver's bookings (admin)")
async def driver_bookings(driver_id: str, admin: AdminUser, page_params: Pagination) -> dict:
    return await booking_service.list_bookings(
        page_params.page,
        page_params.page_size,
        extra_query={"driver_id": object_id(driver_id, "driver_id")},
        sort_field="scheduled_at",
        sort_direction=-1,
    )


@router.get("/{driver_id}/earnings", summary="A driver's earnings (admin)")
async def driver_earnings(driver_id: str, admin: AdminUser) -> dict:
    return await driver_service.earnings_summary(object_id(driver_id, "driver_id"))


@router.get("/{driver_id}/documents", summary="A driver's documents (admin)")
async def driver_documents(driver_id: str, admin: AdminUser) -> dict:
    profile = await driver_service.require_driver(object_id(driver_id, "driver_id"))
    return {
        "documents": profile.get("documents", []),
        "verification_status": profile.get("verification_status"),
    }


# ---------------------------------------------------------------------------
# Wallet (admin)
# ---------------------------------------------------------------------------


@router.get("/{driver_id}/wallet", summary="A driver's wallet and statement (admin)")
async def driver_wallet(driver_id: str, admin: AdminUser, page: int = 1) -> dict:
    oid = object_id(driver_id, "driver_id")
    driver = await driver_service.require_driver(oid)
    summary = await wallet_service.eligibility(driver)
    statement = await wallet_service.statement(oid, page=max(1, page), page_size=20)
    # Surfaced so a mismatch between the stored balance and the ledger is
    # visible in the admin UI rather than discovered during an argument.
    audit = await wallet_service.reconcile(oid)
    return {"summary": summary, "statement": statement, "audit": audit}


@router.post(
    "/{driver_id}/wallet/topup",
    dependencies=[Depends(write_rate_limit)],
    summary="Record a security deposit received from a driver (admin)",
)
async def topup_wallet(driver_id: str, payload: WalletTopUp, admin: AdminUser) -> dict:
    """Admin-only: this records money that has actually arrived.

    A driver must never be able to credit their own wallet — that would make
    the entire deposit requirement decorative. When a payment gateway is wired
    up, its verified webhook calls `wallet_service.credit` instead.
    """
    return await wallet_service.credit(
        object_id(driver_id, "driver_id"),
        payload.amount,
        note=payload.note or "Security deposit",
        actor_id=str(admin["_id"]),
    )


@router.post(
    "/{driver_id}/wallet/adjust",
    dependencies=[Depends(write_rate_limit)],
    summary="Correct a wallet balance, up or down (admin)",
)
async def adjust_wallet(driver_id: str, payload: WalletAdjustment, admin: AdminUser) -> dict:
    oid = object_id(driver_id, "driver_id")
    if payload.amount == 0:
        raise ValidationError("Adjustment cannot be zero.")
    if payload.amount > 0:
        return await wallet_service.credit(
            oid, payload.amount, txn_type=WalletTxnType.ADJUSTMENT,
            note=payload.note, actor_id=str(admin["_id"]),
        )
    return await wallet_service.debit(
        oid, abs(payload.amount), txn_type=WalletTxnType.ADJUSTMENT,
        note=payload.note, actor_id=str(admin["_id"]),
    )


@router.get("/wallet/withdrawals/pending", summary="Withdrawal requests awaiting a decision (admin)")
async def pending_withdrawals(admin: AdminUser) -> dict:
    items = await wallet_service.list_withdrawals(status="pending")
    for item in items:
        driver = await mongodb.drivers().find_one(
            {"_id": object_id(item["driver_id"], "driver_id")}, {"user_id": 1}
        )
        if driver:
            user = await mongodb.users().find_one(
                {"_id": driver["user_id"]}, {"name": 1, "phone": 1}
            )
            item["driver_name"] = (user or {}).get("name")
            item["driver_phone"] = (user or {}).get("phone")
    return {"items": items, "total": len(items)}


@router.post(
    "/wallet/withdrawals/{request_id}/approve",
    dependencies=[Depends(write_rate_limit)],
    summary="Approve a withdrawal once the transfer has been made (admin)",
)
async def approve_withdrawal(
    request_id: str, admin: AdminUser, reference: str | None = Query(None, max_length=120)
) -> dict:
    """Approving is what debits the wallet, so only do it after paying out."""
    return await wallet_service.approve_withdrawal(
        object_id(request_id, "request_id"), actor_id=admin["_id"], reference=reference
    )


@router.post(
    "/wallet/withdrawals/{request_id}/reject",
    dependencies=[Depends(write_rate_limit)],
    summary="Decline a withdrawal request (admin)",
)
async def reject_withdrawal(
    request_id: str, admin: AdminUser, reason: str | None = Query(None, max_length=300)
) -> dict:
    return await wallet_service.reject_withdrawal(
        object_id(request_id, "request_id"), actor_id=admin["_id"], reason=reason
    )
