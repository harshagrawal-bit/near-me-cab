"""/api/bookings — creation and the full booking lifecycle.

Every read is scoped by role inside the handler: a customer sees only their
own bookings, a driver only trips assigned to them, an admin sees everything.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, Query, status

from app.api.deps import (
    AdminUser,
    BookingFilterParams,
    CurrentDriver,
    CurrentUser,
    CustomerUser,
    Pagination,
)
from app.core.errors import PermissionError_
from app.core.rate_limit import write_rate_limit
from app.models.enums import (
    ACTIVE_BOOKING_STATUSES,
    BookingStatus,
    Role,
    UPCOMING_BOOKING_STATUSES,
)
from app.schemas.booking import (
    AssignDriverRequest,
    BookingCancel,
    BookingCreate,
    BookingStatusUpdate,
    FareOverrideRequest,
    PaymentRecord,
    PaymentStatusUpdate,
)
from app.schemas.common import object_id
from app.services import booking_service, driver_service

router = APIRouter(prefix="/bookings", tags=["bookings"])

BUCKET_QUERIES = {
    "upcoming": {"status": {"$in": [s.value for s in UPCOMING_BOOKING_STATUSES]}},
    "active": {"status": {"$in": [s.value for s in ACTIVE_BOOKING_STATUSES]}},
    "completed": {"status": BookingStatus.COMPLETED.value},
    "cancelled": {"status": BookingStatus.CANCELLED.value},
}


@router.post(
    "",
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(write_rate_limit)],
    summary="Create a booking (customer)",
)
async def create_booking(payload: BookingCreate, customer: CustomerUser) -> dict:
    return await booking_service.create_booking(customer, payload)


@router.get("", summary="List bookings visible to the current role")
async def list_bookings(
    user: CurrentUser,
    page_params: Pagination,
    filters: BookingFilterParams,
    bucket: str | None = Query(None, pattern="^(upcoming|active|completed|cancelled)$"),
) -> dict:
    extra = dict(BUCKET_QUERIES.get(bucket or "", {}))
    sort_field, sort_direction = "created_at", -1

    if user["role"] == Role.CUSTOMER.value:
        extra["customer_id"] = user["_id"]
        filters.pop("customer_id", None)
    elif user["role"] == Role.DRIVER.value:
        driver = await driver_service.require_driver_for_user(user["_id"])
        extra["driver_id"] = driver["_id"]
        filters.pop("driver_id", None)
        sort_field, sort_direction = "scheduled_at", 1

    return await booking_service.list_bookings(
        page_params.page,
        page_params.page_size,
        filters=filters,
        extra_query=extra,
        sort_field=sort_field,
        sort_direction=sort_direction,
        viewer_role=user["role"],
    )


@router.get("/summary", summary="Booking counts for the current customer")
async def summary(customer: CustomerUser) -> dict:
    return await booking_service.customer_buckets(customer["_id"])


@router.get("/{booking_id}", summary="Booking detail")
async def get_booking(booking_id: str, user: CurrentUser) -> dict:
    driver = (
        await driver_service.get_by_user_id(user["_id"])
        if user["role"] == Role.DRIVER.value
        else None
    )
    return await booking_service.get_for_actor(
        object_id(booking_id, "booking_id"), user=user, driver=driver
    )


@router.post(
    "/{booking_id}/cancel",
    dependencies=[Depends(write_rate_limit)],
    summary="Cancel a booking (customer or admin)",
)
async def cancel_booking(booking_id: str, payload: BookingCancel, user: CurrentUser) -> dict:
    if user["role"] == Role.DRIVER.value:
        raise PermissionError_("Drivers cannot cancel bookings. Contact the operations team.")
    return await booking_service.cancel_booking(
        object_id(booking_id, "booking_id"),
        actor_id=user["_id"],
        actor_role=user["role"],
        reason=payload.reason,
    )


@router.post(
    "/{booking_id}/status",
    dependencies=[Depends(write_rate_limit)],
    summary="Advance the booking status (admin or assigned driver)",
)
async def update_status(booking_id: str, payload: BookingStatusUpdate, user: CurrentUser) -> dict:
    booking_oid = object_id(booking_id, "booking_id")
    if user["role"] == Role.ADMIN.value:
        return await booking_service.change_status(
            booking_oid,
            payload.status,
            actor_id=user["_id"],
            actor_role=Role.ADMIN.value,
            note=payload.note,
        )
    if user["role"] == Role.DRIVER.value:
        driver = await driver_service.require_driver_for_user(user["_id"])
        return await booking_service.driver_change_status(
            booking_oid, driver, payload.status, payload.note
        )
    raise PermissionError_("You cannot change the status of this booking.")


# ---------------------------------------------------------------------------
# Advance payment
# ---------------------------------------------------------------------------


@router.post(
    "/{booking_id}/confirm-availability",
    dependencies=[Depends(write_rate_limit)],
    summary="Confirm a car is available and request the advance (admin)",
)
async def confirm_availability(booking_id: str, admin: AdminUser) -> dict:
    """Moves the booking to 'Awaiting Advance' with a server-computed amount.

    The percentage comes from admin settings; the fare comes from the stored
    booking. Nothing about the amount is taken from the client.
    """
    return await booking_service.confirm_availability(
        object_id(booking_id, "booking_id"), actor_id=admin["_id"]
    )


@router.post(
    "/{booking_id}/advance-paid",
    dependencies=[Depends(write_rate_limit)],
    summary="Record the advance as received and confirm the booking (admin)",
)
async def mark_advance_paid(booking_id: str, admin: AdminUser) -> dict:
    """Admin-only *on purpose*.

    There is no payment gateway wired up yet, so this records money operations
    have actually received. Letting a customer call it would let anyone confirm
    a booking without paying. When Razorpay is integrated, its verified webhook
    calls `booking_service.pay_advance` directly and this stays as the manual
    fallback for cash or bank transfers.
    """
    return await booking_service.pay_advance(
        object_id(booking_id, "booking_id"),
        actor_id=admin["_id"],
        actor_role=Role.ADMIN.value,
    )


# ---------------------------------------------------------------------------
# Admin-only booking management
# ---------------------------------------------------------------------------


@router.post(
    "/{booking_id}/assign-driver",
    dependencies=[Depends(write_rate_limit)],
    summary="Assign or reassign a driver (admin)",
)
async def assign_driver(booking_id: str, payload: AssignDriverRequest, admin: AdminUser) -> dict:
    return await booking_service.assign_driver(
        object_id(booking_id, "booking_id"),
        object_id(payload.driver_id, "driver_id"),
        vehicle_oid=object_id(payload.vehicle_id, "vehicle_id") if payload.vehicle_id else None,
        actor_id=admin["_id"],
        note=payload.note,
    )


@router.post("/{booking_id}/fare", summary="Override the fare (admin)")
async def override_fare(booking_id: str, payload: FareOverrideRequest, admin: AdminUser) -> dict:
    return await booking_service.override_fare(
        object_id(booking_id, "booking_id"), payload, actor_id=admin["_id"]
    )


@router.post("/{booking_id}/payments", summary="Record a payment against a booking (admin)")
async def record_payment(booking_id: str, payload: PaymentRecord, admin: AdminUser) -> dict:
    return await booking_service.record_payment(
        object_id(booking_id, "booking_id"), payload, actor_id=admin["_id"]
    )


@router.post("/{booking_id}/payment-status", summary="Set the payment status (admin)")
async def set_payment_status(
    booking_id: str, payload: PaymentStatusUpdate, admin: AdminUser
) -> dict:
    return await booking_service.set_payment_status(
        object_id(booking_id, "booking_id"),
        payload.payment_status,
        actor_id=admin["_id"],
        note=payload.note,
    )


@router.post(
    "/{booking_id}/driver-cancel",
    dependencies=[Depends(write_rate_limit)],
    summary="Driver drops a trip they accepted (charges a penalty)",
)
async def driver_cancel(
    booking_id: str, payload: BookingCancel, driver: CurrentDriver
) -> dict:
    """The trip returns to the pool for another driver rather than being
    killed off — the customer still wants it."""
    return await booking_service.driver_cancel(
        object_id(booking_id, "booking_id"), driver, payload.reason
    )


@router.post(
    "/{booking_id}/refund",
    dependencies=[Depends(write_rate_limit)],
    summary="Refund a customer, in full or in part (admin)",
)
async def refund_booking(
    booking_id: str,
    admin: AdminUser,
    amount: float | None = Query(None, gt=0, le=1_000_000),
    reason: str = Query(..., min_length=3, max_length=300),
) -> dict:
    """Bounded by what was actually paid online — we cannot send back more
    than we received."""
    from app.services import payment_service

    return await payment_service.refund_payment(
        object_id(booking_id, "booking_id"),
        amount=amount,
        reason=reason,
        actor_id=admin["_id"],
    )
