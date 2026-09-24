"""Booking lifecycle: creation, status machine, assignment and cancellation.

Two rules are load-bearing here:

1. The fare is always recomputed from the pricing collection. A price sent by
   a client is never read.
2. Every status change goes through `_apply_status`, which validates the
   transition and appends to `booking_status_history`.
"""

from __future__ import annotations

import datetime as dt
import os
import re
from typing import Any

from bson import ObjectId

from app.core.errors import ConflictError, NotFoundError, PermissionError_, ValidationError
from app.db import mongodb
from app.models.enums import (
    ACTIVE_BOOKING_STATUSES,
    BOOKING_STATUS_LABELS,
    CUSTOMER_CANCELLABLE,
    DRIVER_ALLOWED_TRANSITIONS,
    TERMINAL_BOOKING_STATUSES,
    AdvanceStatus,
    BookingStatus,
    DriverStatus,
    NotificationType,
    PaymentMethod,
    PaymentStatus,
    Role,
    TripType,
    VehicleStatus,
    VehicleType,
    VerificationStatus,
    can_transition,
)
from app.schemas.booking import (
    BookingCreate,
    FareOverrideRequest,
    PaymentRecord,
)
from app.schemas.common import build_page, ensure_aware, object_id, serialize, utcnow
from app.services import (
    coupon_service,
    driver_service,
    notification_service,
    payment_service,
    pricing_service,
    route_service,
    settings_service,
    user_service,
    vehicle_service,
)

# Prefix on every human-facing booking reference (NM-20260806-0001).
# Existing references keep whatever prefix they were created with.
BOOKING_PREFIX = os.getenv("BOOKING_PREFIX", "NM")


# ---------------------------------------------------------------------------
# Reference generation
# ---------------------------------------------------------------------------


async def _next_booking_reference() -> str:
    """Human-friendly, monotonically increasing reference: LR-20260801-0007."""
    today = utcnow().strftime("%Y%m%d")
    doc = await mongodb.counters().find_one_and_update(
        {"_id": f"booking:{today}"},
        {"$inc": {"seq": 1}},
        upsert=True,
        return_document=True,
    )
    sequence = doc.get("seq", 1) if doc else 1
    return f"{BOOKING_PREFIX}-{today}-{sequence:04d}"


# ---------------------------------------------------------------------------
# Status history
# ---------------------------------------------------------------------------


async def _record_history(
    booking_id: ObjectId,
    from_status: str | None,
    to_status: str,
    *,
    actor_id: ObjectId | None,
    actor_role: str,
    note: str | None = None,
) -> None:
    await mongodb.booking_status_history().insert_one(
        {
            "booking_id": booking_id,
            "from_status": from_status,
            "to_status": to_status,
            "label": BOOKING_STATUS_LABELS.get(to_status, to_status),
            "changed_by": actor_id,
            "changed_by_role": actor_role,
            "note": note,
            "created_at": utcnow(),
        }
    )


async def get_history(booking_id: ObjectId) -> list[dict[str, Any]]:
    cursor = mongodb.booking_status_history().find({"booking_id": booking_id}).sort("created_at", 1)
    return [serialize(doc) async for doc in cursor]


# ---------------------------------------------------------------------------
# Creation
# ---------------------------------------------------------------------------


async def create_booking(customer: dict[str, Any], payload: BookingCreate) -> dict[str, Any]:
    config = await settings_service.get_settings()
    scheduled_at = ensure_aware(payload.scheduled_at)
    now = utcnow()

    earliest = now + dt.timedelta(minutes=config.booking.min_advance_minutes)
    if scheduled_at < earliest:
        raise ValidationError(
            f"Please schedule the pickup at least {config.booking.min_advance_minutes} "
            "minutes from now."
        )
    latest = now + dt.timedelta(days=config.booking.max_advance_days)
    if scheduled_at > latest:
        raise ValidationError(
            f"Bookings can be made up to {config.booking.max_advance_days} days in advance."
        )

    route = await pricing_service.resolve_route(
        route_id=payload.route_id,
        pickup=payload.pickup.address,
        drop=payload.drop.address,
    )

    # ---- Authoritative fare. Anything the client sent about price is ignored.
    breakdown, coupon = await pricing_service.quote_for_booking(
        route=route,
        vehicle_type=payload.vehicle_type,
        trip_type=payload.trip_type,
        scheduled_at=scheduled_at,
        coupon_code=payload.coupon_code,
    )

    seats = vehicle_service.vehicle_class(payload.vehicle_type.value)["seating_capacity"]
    if payload.passenger_count > seats:
        raise ValidationError(
            f"A {vehicle_service.vehicle_class(payload.vehicle_type.value)['label']} seats "
            f"{seats} passengers. Please choose a larger vehicle."
        )

    reference = await _next_booking_reference()
    document = {
        "booking_id": reference,
        "customer_id": customer["_id"],
        "route_id": route["_id"],
        "pickup": payload.pickup.model_dump(),
        "drop": payload.drop.model_dump(),
        "trip_type": payload.trip_type.value,
        "vehicle_type": payload.vehicle_type.value,
        "vehicle_id": None,
        "driver_id": None,
        "scheduled_at": scheduled_at,
        "return_at": ensure_aware(payload.return_at),
        "passenger_count": payload.passenger_count,
        "passenger_name": payload.passenger_name,
        "passenger_phone": payload.passenger_phone,
        "notes": payload.notes,
        "coupon_code": coupon["code"] if coupon else None,
        "discount": breakdown.discount,
        "fare_breakdown": breakdown.model_dump(),
        "quoted_fare": breakdown.total,
        "total_fare": breakdown.total,
        "fare_overridden": False,
        "currency": breakdown.currency,
        "status": BookingStatus.REQUESTED.value,
        "payment_status": (
            PaymentStatus.CASH.value
            if payload.payment_method == PaymentMethod.CASH
            else PaymentStatus.PENDING.value
        ),
        "payment_method": payload.payment_method.value,
        "payment_option": payload.payment_option,
        "amount_paid": 0.0,
        "cancelled_reason": None,
        "cancelled_by": None,
        "cancelled_at": None,
        "completed_at": None,
        "created_at": now,
        "updated_at": now,
    }
    result = await mongodb.bookings().insert_one(document)
    document["_id"] = result.inserted_id

    await _record_history(
        result.inserted_id,
        None,
        BookingStatus.REQUESTED.value,
        actor_id=customer["_id"],
        actor_role=Role.CUSTOMER.value,
        note="Booking requested by customer.",
    )
    if coupon:
        await coupon_service.consume(coupon["code"])

    await notification_service.notify(
        user_id=customer["_id"],
        notification_type=NotificationType.BOOKING_CREATED,
        title=f"Booking {reference} received",
        body="We have your request. Our team will confirm it shortly.",
        booking_id=result.inserted_id,
        data={"booking_id": reference},
    )
    for admin_id in await user_service.get_admin_recipients():
        await notification_service.notify(
            user_id=admin_id,
            notification_type=NotificationType.BOOKING_CREATED,
            title=f"New booking {reference}",
            body=f"{route['name']} · {breakdown.currency} {breakdown.total:,.0f}",
            booking_id=result.inserted_id,
            data={"booking_id": reference},
        )

    if config.booking.auto_confirm:
        # Through confirm_availability, not straight to CONFIRMED: the advance
        # rule has to apply to an auto-confirmed booking too, or switching this
        # setting on quietly stops anyone ever being asked to pay up front.
        await confirm_availability(
            result.inserted_id,
            actor_id=None,
            actor_role="system",
            note="Auto-confirmed by system settings.",
        )

    return await require_booking(result.inserted_id)


# ---------------------------------------------------------------------------
# Status transitions
# ---------------------------------------------------------------------------


async def _apply_status(
    booking: dict[str, Any],
    target: BookingStatus,
    *,
    actor_id: ObjectId | None,
    actor_role: str,
    note: str | None,
    extra: dict[str, Any] | None = None,
) -> None:
    current = booking["status"]
    if not can_transition(current, target.value):
        raise ConflictError(
            f"A booking that is '{BOOKING_STATUS_LABELS.get(current, current)}' cannot move to "
            f"'{BOOKING_STATUS_LABELS.get(target.value, target.value)}'."
        )
    changes: dict[str, Any] = {"status": target.value, "updated_at": utcnow(), **(extra or {})}
    if target == BookingStatus.COMPLETED:
        changes["completed_at"] = utcnow()
    await mongodb.bookings().update_one({"_id": booking["_id"]}, {"$set": changes})
    await _record_history(
        booking["_id"], current, target.value, actor_id=actor_id, actor_role=actor_role, note=note
    )
    await _sync_side_effects(booking, target)
    await _notify_status(booking, target)


async def _sync_side_effects(booking: dict[str, Any], target: BookingStatus) -> None:
    """Keep vehicle/driver availability and trip counts in step with the trip."""
    vehicle_id = booking.get("vehicle_id")
    driver_id = booking.get("driver_id")

    if target in {BookingStatus.PICKED_UP, BookingStatus.TRIP_STARTED} and vehicle_id:
        await vehicle_service.set_status(vehicle_id, VehicleStatus.ON_TRIP)
    elif target in TERMINAL_BOOKING_STATUSES:
        if vehicle_id:
            vehicle = await mongodb.vehicles().find_one({"_id": vehicle_id})
            if vehicle and vehicle.get("status") != VehicleStatus.MAINTENANCE.value:
                next_status = (
                    VehicleStatus.ASSIGNED
                    if vehicle.get("assigned_driver_id")
                    else VehicleStatus.AVAILABLE
                )
                await vehicle_service.set_status(vehicle_id, next_status)
        if driver_id and target == BookingStatus.COMPLETED:
            await mongodb.drivers().update_one({"_id": driver_id}, {"$inc": {"total_trips": 1}})

        # A trip that is over — completed or cancelled — must not keep a fleet
        # owner's deposit tied up. Releasing here rather than in each caller
        # means no exit path can forget to do it.
        owner_id = booking.get("fleet_owner_id")
        if owner_id:
            from app.services import wallet_service

            await wallet_service.release(owner_id, booking["_id"])


async def _notify_status(booking: dict[str, Any], target: BookingStatus) -> None:
    copy = {
        BookingStatus.AWAITING_PAYMENT: (
            "Car available — pay to confirm",
            "We have a car for your trip. Pay the advance to confirm the booking.",
        ),
        BookingStatus.CONFIRMED: ("Booking confirmed", "Your trip is confirmed. A driver will be assigned soon."),
        BookingStatus.DRIVER_ASSIGNED: ("Driver assigned", "A driver has been assigned to your trip."),
        BookingStatus.ACCEPTED: ("Driver accepted", "Your driver has accepted the trip."),
        BookingStatus.DRIVER_ARRIVING: ("Driver on the way", "Your driver is heading to the pickup point."),
        BookingStatus.PICKED_UP: ("Picked up", "You have been picked up. Have a safe trip."),
        BookingStatus.TRIP_STARTED: ("Trip started", "Your trip is now in progress."),
        BookingStatus.COMPLETED: ("Trip completed", "Thanks for riding with us. Tell us how it went."),
        BookingStatus.CANCELLED: ("Booking cancelled", "Your booking has been cancelled."),
    }.get(target)
    if not copy:
        return
    title, body = copy
    await notification_service.notify(
        user_id=booking["customer_id"],
        notification_type=NotificationType.TRIP_UPDATE,
        title=f"{title} · {booking['booking_id']}",
        body=body,
        booking_id=booking["_id"],
        data={"booking_id": booking["booking_id"], "status": target.value},
    )


# ---------------------------------------------------------------------------
# Advance payment
# ---------------------------------------------------------------------------


def upfront_for_option(
    total_fare: float, option: str, *, advance_settings: Any, option_settings: Any
) -> dict[str, Any]:
    """How much a customer pays now, given the option they chose.

    Three shapes, matching what customers expect from this market:

    * `pay_later` — nothing now, settle the whole fare with the driver.
    * `part`      — a percentage now to hold the car, the rest at the drop.
    * `full`      — the entire fare now.

    The option is a *name*, never an amount: the figure is always derived here
    from the stored fare, so a client cannot choose what it owes. An option the
    operator has switched off falls back to the standard advance rather than
    being honoured silently.
    """
    total = round(float(total_fare), 2)
    allowed = {
        "pay_later": option_settings.allow_pay_later,
        "part": option_settings.allow_part_payment,
        "full": option_settings.allow_full_payment,
    }
    if option not in allowed or not allowed[option]:
        option = "part" if option_settings.allow_part_payment else "pay_later"

    if option == "pay_later":
        return {"option": option, "percent": 0.0, "amount": 0.0, "balance_due": total}
    if option == "full":
        return {"option": option, "percent": 100.0, "amount": total, "balance_due": 0.0}

    # A part payment is the advance — same percentage, same floor, same
    # ceiling — so it goes through the one function that already knows the rule.
    advance = compute_advance(total, advance_settings)
    return {
        "option": "part",
        "percent": advance["percent"],
        "amount": advance["amount"],
        "balance_due": advance["balance_due"],
    }


def compute_advance(total_fare: float, advance_settings: Any) -> dict[str, Any]:
    """What the customer must pay up front to hold this booking.

    Derived on the server from the stored fare and admin settings. The client
    is never asked what the advance is, and never believed if it says.
    """
    if not advance_settings.enabled or total_fare <= 0:
        return {"percent": 0.0, "amount": 0.0, "balance_due": round(float(total_fare), 2)}

    amount = float(total_fare) * float(advance_settings.percent) / 100
    amount = max(amount, float(advance_settings.min_amount or 0))
    ceiling = float(advance_settings.max_amount or 0)
    if ceiling > 0:
        amount = min(amount, ceiling)
    # Never ask for more than the trip costs.
    amount = round(min(amount, float(total_fare)), 2)
    return {
        "percent": float(advance_settings.percent),
        "amount": amount,
        "balance_due": round(float(total_fare) - amount, 2),
    }


async def confirm_availability(
    booking_oid: ObjectId,
    *,
    actor_id: ObjectId | None,
    note: str | None = None,
    actor_role: str = Role.ADMIN.value,
) -> dict[str, Any]:
    """Confirm a car is available, which asks the customer for the advance.

    With the advance switched off in settings this goes straight to CONFIRMED,
    so the feature can be turned off without stranding bookings mid-flow.

    `actor_role` exists so auto-confirm can come through here as the system
    rather than skipping to CONFIRMED on its own — otherwise turning auto-
    confirm on silently disables the advance, and no customer is ever asked
    to pay one.
    """
    from app.services import settings_service

    booking = await _raw_booking(booking_oid)
    settings = await settings_service.get_settings()
    total = float(booking.get("total_fare") or 0)

    # Honour what the customer picked at booking time. A booking made before
    # this existed has no option stored, so it falls back to the advance rule
    # rather than being treated as pay-later and confirmed for free.
    chosen = booking.get("payment_option")
    if chosen:
        advance = upfront_for_option(
            total,
            chosen,
            advance_settings=settings.advance,
            option_settings=settings.payment_options,
        )
    else:
        advance = compute_advance(total, settings.advance)

    if advance["amount"] <= 0:
        await _apply_status(
            booking,
            BookingStatus.CONFIRMED,
            actor_id=actor_id,
            actor_role=actor_role,
            note=note or "Confirmed — no advance required.",
            extra={
                "advance_status": AdvanceStatus.NOT_REQUIRED.value,
                "advance_amount": 0.0,
                "advance_percent": 0.0,
                "balance_due": advance["balance_due"],
            },
        )
        return await require_booking(booking_oid)

    await _apply_status(
        booking,
        BookingStatus.AWAITING_PAYMENT,
        actor_id=actor_id,
        actor_role=actor_role,
        note=note or f"Car available. Advance of ₹{advance['amount']:,.0f} requested.",
        extra={
            "advance_status": AdvanceStatus.PENDING.value,
            "advance_amount": advance["amount"],
            "advance_percent": advance["percent"],
            "balance_due": advance["balance_due"],
            "payment_option": advance.get("option", chosen),
        },
    )
    return await require_booking(booking_oid)


async def pay_advance(
    booking_oid: ObjectId,
    *,
    actor_id: ObjectId,
    actor_role: str,
    provider: str = "manual",
    reference: str | None = None,
) -> dict[str, Any]:
    """Record the advance and confirm the booking.

    NOTE: no payment gateway is wired up yet. This records money that has
    actually been received — which is why the route behind it is admin-only.
    When Razorpay lands, the verified webhook calls this with the real
    provider and reference; nothing else here changes.
    """
    booking = await _raw_booking(booking_oid)
    if booking["status"] != BookingStatus.AWAITING_PAYMENT.value:
        raise ConflictError("This booking is not waiting for an advance payment.")
    if booking.get("advance_status") == AdvanceStatus.PAID.value:
        raise ConflictError("The advance has already been paid.")

    amount = float(booking.get("advance_amount") or 0)
    now = utcnow()
    await mongodb.payments().insert_one(
        {
            "booking_id": booking_oid,
            "booking_reference": booking["booking_id"],
            "customer_id": booking["customer_id"],
            "amount": amount,
            "kind": "advance",
            "status": PaymentStatus.PAID.value,
            "method": PaymentMethod.UPI.value,
            "provider": provider,
            "provider_reference": reference,
            "created_at": now,
            "updated_at": now,
        }
    )
    await _apply_status(
        booking,
        BookingStatus.CONFIRMED,
        actor_id=actor_id,
        actor_role=actor_role,
        note=f"Advance of ₹{amount:,.0f} received.",
        extra={"advance_status": AdvanceStatus.PAID.value, "advance_paid_at": now},
    )
    return await require_booking(booking_oid)


async def change_status(
    booking_oid: ObjectId,
    target: BookingStatus,
    *,
    actor_id: ObjectId | None,
    actor_role: str,
    note: str | None = None,
) -> dict[str, Any]:
    booking = await _raw_booking(booking_oid)
    if target == BookingStatus.DRIVER_ASSIGNED and not booking.get("driver_id"):
        raise ValidationError("Assign a driver before moving the booking to this status.")
    await _apply_status(booking, target, actor_id=actor_id, actor_role=actor_role, note=note)
    return await require_booking(booking_oid)


async def driver_change_status(
    booking_oid: ObjectId,
    driver: dict[str, Any],
    target: BookingStatus,
    note: str | None = None,
) -> dict[str, Any]:
    if target not in DRIVER_ALLOWED_TRANSITIONS:
        raise PermissionError_("Drivers cannot set this status.")
    booking = await _raw_booking(booking_oid)
    if booking.get("driver_id") != driver["_id"]:
        raise PermissionError_("This trip is not assigned to you.")
    # Remembered so a later cancellation can tell a drop seconds after
    # accepting from one an hour before pickup.
    extra = {"accepted_at": utcnow()} if target == BookingStatus.ACCEPTED else None
    await _apply_status(
        booking,
        target,
        actor_id=driver["user_id"],
        actor_role=Role.DRIVER.value,
        note=note,
        extra=extra,
    )
    return await require_booking(booking_oid)


async def driver_cancel(
    booking_oid: ObjectId, driver: dict[str, Any], reason: str
) -> dict[str, Any]:
    """A driver drops a trip they had accepted, and pays for it.

    The penalty is charged before the booking moves, so a driver cannot dodge
    it by cancelling twice in quick succession — the second call finds a
    booking already cancelled and stops.
    """
    from app.services import wallet_service

    booking = await _raw_booking(booking_oid)
    if booking.get("driver_id") != driver["_id"]:
        raise PermissionError_("This trip is not assigned to you.")
    if booking["status"] in TERMINAL_BOOKING_STATUSES:
        raise ConflictError("This trip is already closed.")
    if booking["status"] in {BookingStatus.PICKED_UP.value, BookingStatus.TRIP_STARTED.value}:
        raise ConflictError("The trip has already started. Call support instead.")

    config = (await settings_service.get_settings()).cancellation
    penalty = wallet_service.penalty_for_cancellation(
        accepted_at=ensure_aware(booking["accepted_at"]) if booking.get("accepted_at") else None,
        scheduled_at=ensure_aware(booking["scheduled_at"]),
        settings=config,
        now=utcnow(),
        total_fare=float(booking.get("total_fare") or 0),
    )
    charged = await wallet_service.charge_penalty(
        driver["_id"],
        penalty["amount"],
        reason=penalty["reason"],
        booking_id=booking_oid,
        actor_id=str(driver["user_id"]),
    )

    # Back to CONFIRMED, not CANCELLED: the customer still wants the trip, so
    # it returns to the pool for another driver rather than being killed off.
    await _apply_status(
        booking,
        BookingStatus.CONFIRMED,
        actor_id=driver["user_id"],
        actor_role=Role.DRIVER.value,
        note=f"Driver cancelled: {reason}. Penalty ₹{penalty['amount']:,.0f}.",
        extra={"driver_id": None, "vehicle_id": None, "accepted_at": None},
    )
    await wallet_service.release(driver["_id"], booking_oid)

    await notification_service.notify(
        user_id=driver["user_id"],
        notification_type=NotificationType.TRIP_UPDATE,
        title=f"Cancellation charge ₹{penalty['amount']:,.0f}",
        body=penalty["reason"],
        booking_id=booking_oid,
    )
    return {
        "booking": await require_booking(booking_oid),
        "penalty": charged,
    }


# ---------------------------------------------------------------------------
# Assignment
# ---------------------------------------------------------------------------


async def assign_driver(
    booking_oid: ObjectId,
    driver_oid: ObjectId,
    *,
    vehicle_oid: ObjectId | None,
    actor_id: ObjectId,
    note: str | None = None,
) -> dict[str, Any]:
    booking = await _raw_booking(booking_oid)
    if booking["status"] in TERMINAL_BOOKING_STATUSES:
        raise ConflictError("This booking is closed and cannot be assigned.")
    if booking["status"] == BookingStatus.REQUESTED.value:
        raise ConflictError("Confirm the booking before assigning a driver.")

    driver = await driver_service.get_driver(driver_oid)
    if not driver:
        raise NotFoundError("Driver not found.")
    if driver.get("status") != DriverStatus.ACTIVE.value:
        raise ValidationError("This driver is inactive.")
    if driver.get("verification_status") != VerificationStatus.VERIFIED.value:
        raise ValidationError("This driver is not verified yet.")

    vehicle_id = vehicle_oid or driver.get("assigned_vehicle_id")
    if not vehicle_id:
        raise ValidationError("This driver has no vehicle assigned. Assign one first.")
    vehicle = await vehicle_service.get_vehicle(vehicle_id)
    if not vehicle:
        raise NotFoundError("Vehicle not found.")
    if vehicle.get("status") in {VehicleStatus.MAINTENANCE.value, VehicleStatus.INACTIVE.value}:
        raise ValidationError("That vehicle is not currently in service.")

    clash = await _scheduling_clash(driver_oid, booking)
    if clash:
        raise ConflictError(
            f"This driver already has booking {clash['booking_id']} around that time."
        )

    previous_driver = booking.get("driver_id")
    is_reassignment = previous_driver is not None and previous_driver != driver_oid

    await mongodb.bookings().update_one(
        {"_id": booking_oid},
        {"$set": {"driver_id": driver_oid, "vehicle_id": vehicle_id, "updated_at": utcnow()}},
    )
    refreshed = await _raw_booking(booking_oid)
    await _apply_status(
        refreshed,
        BookingStatus.DRIVER_ASSIGNED,
        actor_id=actor_id,
        actor_role=Role.ADMIN.value,
        note=note or ("Driver reassigned." if is_reassignment else "Driver assigned."),
    )

    await notification_service.notify(
        user_id=driver["user_id"],
        notification_type=NotificationType.DRIVER_ASSIGNED,
        title=f"New trip {booking['booking_id']}",
        body=f"Pickup at {booking['pickup']['address']}.",
        booking_id=booking_oid,
        data={"booking_id": booking["booking_id"]},
        channels=notification_service.URGENT_CHANNELS,
    )

    # The message the customer is actually waiting for. Carries the driver's
    # name and number, because "a driver has been assigned" without them just
    # generates a call to the office.
    driver_user = await mongodb.users().find_one(
        {"_id": driver["user_id"]}, {"name": 1, "phone": 1}
    )
    driver_name = (driver_user or {}).get("name") or "Your driver"
    driver_phone = (driver_user or {}).get("phone")
    vehicle_note = ""
    if booking.get("vehicle_id"):
        vehicle = await mongodb.vehicles().find_one(
            {"_id": booking["vehicle_id"]}, {"registration_number": 1, "model": 1}
        )
        if vehicle:
            vehicle_note = " · " + " ".join(
                part for part in (vehicle.get("model"), vehicle.get("registration_number")) if part
            )
    await notification_service.notify(
        user_id=booking["customer_id"],
        notification_type=NotificationType.DRIVER_ASSIGNED,
        title=f"Driver assigned · {booking['booking_id']}",
        body=(
            f"{driver_name}"
            + (f" ({driver_phone})" if driver_phone else "")
            + vehicle_note
            + f" will pick you up at {booking['pickup']['address']}."
        ),
        booking_id=booking_oid,
        data={"booking_id": booking["booking_id"], "driver_phone": driver_phone},
        channels=notification_service.URGENT_CHANNELS,
    )
    if is_reassignment:
        old_driver = await driver_service.get_driver(previous_driver)
        if old_driver:
            await notification_service.notify(
                user_id=old_driver["user_id"],
                notification_type=NotificationType.TRIP_UPDATE,
                title=f"Trip {booking['booking_id']} reassigned",
                body="This trip has been moved to another driver.",
                booking_id=booking_oid,
            )
    return await require_booking(booking_oid)


async def _scheduling_clash(driver_oid: ObjectId, booking: dict[str, Any]) -> dict | None:
    """Refuse a second trip for the same driver within a two-hour window."""
    scheduled = ensure_aware(booking["scheduled_at"])
    window = dt.timedelta(hours=2)
    return await mongodb.bookings().find_one(
        {
            "_id": {"$ne": booking["_id"]},
            "driver_id": driver_oid,
            "status": {"$in": list(ACTIVE_BOOKING_STATUSES)},
            "scheduled_at": {"$gte": scheduled - window, "$lte": scheduled + window},
        },
        {"booking_id": 1},
    )


# ---------------------------------------------------------------------------
# Cancellation
# ---------------------------------------------------------------------------


async def cancel_booking(
    booking_oid: ObjectId,
    *,
    actor_id: ObjectId | None,
    actor_role: str,
    reason: str,
) -> dict[str, Any]:
    booking = await _raw_booking(booking_oid)
    if booking["status"] in TERMINAL_BOOKING_STATUSES:
        raise ConflictError("This booking is already closed.")

    if actor_role == Role.CUSTOMER.value:
        if booking["customer_id"] != actor_id:
            raise PermissionError_("You can only cancel your own bookings.")
        if BookingStatus(booking["status"]) not in CUSTOMER_CANCELLABLE:
            raise ConflictError(
                "This trip has already started. Please call support to cancel it."
            )

    settings = await settings_service.get_settings()
    rules = settings.cancellation
    scheduled = ensure_aware(booking["scheduled_at"])
    hours_out = (scheduled - utcnow()).total_seconds() / 3600

    # The fee comes out of the advance the customer actually paid, not out of
    # the total fare. Charging a share of a fare nobody has paid yet would
    # produce a "fee" larger than the money we are holding, and a refund that
    # cannot cover it.
    fee = 0.0
    advance_paid = float(booking.get("advance_amount") or 0) if booking.get(
        "advance_status"
    ) == AdvanceStatus.PAID.value else 0.0
    if (
        actor_role == Role.CUSTOMER.value
        and hours_out < rules.customer_free_hours
        and rules.customer_fee_percent > 0
        and advance_paid > 0
    ):
        fee = round(advance_paid * rules.customer_fee_percent / 100.0, 2)

    await _apply_status(
        booking,
        BookingStatus.CANCELLED,
        actor_id=actor_id,
        actor_role=actor_role,
        note=reason,
        extra={
            "cancelled_reason": reason,
            "cancelled_by": actor_role,
            "cancelled_at": utcnow(),
            "cancellation_fee": fee,
        },
    )
    # Give the advance back before anything else that can fail. Deliberately
    # non-fatal: a cancellation the customer asked for must complete even if
    # the gateway is unreachable, so a failed refund is queued for operations
    # rather than leaving the trip live.
    refund = await payment_service.refund_booking_advance(
        booking, fee=fee, reason=reason
    )
    if refund.get("refunded"):
        await _record_history(
            booking_oid,
            BookingStatus.CANCELLED.value,
            BookingStatus.CANCELLED.value,
            actor_id=actor_id,
            actor_role=actor_role,
            note=f"Advance of ₹{refund['amount']:,.0f} refunded.",
        )
        await notification_service.notify(
            user_id=booking["customer_id"],
            notification_type=NotificationType.BOOKING_CANCELLED,
            title=f"Refund on the way · {booking['booking_id']}",
            body=(
                f"₹{refund['amount']:,.0f} is being returned to the account you "
                "paid from. Banks usually take 5-7 working days."
            ),
            booking_id=booking_oid,
        )
    elif refund.get("pending"):
        await _record_history(
            booking_oid,
            BookingStatus.CANCELLED.value,
            BookingStatus.CANCELLED.value,
            actor_id=actor_id,
            actor_role=actor_role,
            note="Refund queued — needs to be sent by operations.",
        )

    if booking.get("coupon_code"):
        await coupon_service.release(booking["coupon_code"])
    if booking.get("driver_id"):
        driver = await driver_service.get_driver(booking["driver_id"])
        if driver:
            await notification_service.notify(
                user_id=driver["user_id"],
                notification_type=NotificationType.BOOKING_CANCELLED,
                title=f"Trip {booking['booking_id']} cancelled",
                body=reason,
                booking_id=booking_oid,
            )
    return await require_booking(booking_oid)


# ---------------------------------------------------------------------------
# Fare override & payments
# ---------------------------------------------------------------------------


async def override_fare(
    booking_oid: ObjectId, payload: FareOverrideRequest, *, actor_id: ObjectId
) -> dict[str, Any]:
    booking = await _raw_booking(booking_oid)
    if booking["status"] == BookingStatus.CANCELLED.value:
        raise ConflictError("A cancelled booking cannot be repriced.")

    breakdown = dict(booking.get("fare_breakdown") or {})
    breakdown["total"] = float(payload.total_fare)
    await mongodb.bookings().update_one(
        {"_id": booking_oid},
        {
            "$set": {
                "total_fare": float(payload.total_fare),
                "fare_breakdown": breakdown,
                "fare_overridden": True,
                "fare_override_reason": payload.reason,
                "updated_at": utcnow(),
            }
        },
    )
    await _record_history(
        booking_oid,
        booking["status"],
        booking["status"],
        actor_id=actor_id,
        actor_role=Role.ADMIN.value,
        note=f"Fare changed to ₹{payload.total_fare:,.0f}. {payload.reason}",
    )
    await notification_service.notify(
        user_id=booking["customer_id"],
        notification_type=NotificationType.TRIP_UPDATE,
        title=f"Fare updated · {booking['booking_id']}",
        body=f"Your fare is now ₹{payload.total_fare:,.0f}. {payload.reason}",
        booking_id=booking_oid,
    )
    return await require_booking(booking_oid)


async def record_payment(
    booking_oid: ObjectId, payload: PaymentRecord, *, actor_id: ObjectId
) -> dict[str, Any]:
    booking = await _raw_booking(booking_oid)
    now = utcnow()
    await mongodb.payments().insert_one(
        {
            "booking_id": booking_oid,
            "booking_reference": booking["booking_id"],
            "customer_id": booking["customer_id"],
            "amount": float(payload.amount),
            "method": payload.method.value,
            "status": payload.status.value,
            "provider": "manual",
            "provider_reference": payload.reference,
            "note": payload.note,
            "recorded_by": actor_id,
            "created_at": now,
            "updated_at": now,
        }
    )
    paid = float(booking.get("amount_paid") or 0)
    if payload.status in {PaymentStatus.PAID, PaymentStatus.PARTIALLY_PAID, PaymentStatus.CASH}:
        paid += float(payload.amount)
    total = float(booking["total_fare"])
    if payload.status == PaymentStatus.REFUNDED:
        booking_payment_status = PaymentStatus.REFUNDED
    elif payload.status == PaymentStatus.FAILED:
        booking_payment_status = PaymentStatus.FAILED
    elif paid >= total - 0.5:
        booking_payment_status = PaymentStatus.PAID
    elif paid > 0:
        booking_payment_status = PaymentStatus.PARTIALLY_PAID
    else:
        booking_payment_status = PaymentStatus.PENDING

    await mongodb.bookings().update_one(
        {"_id": booking_oid},
        {
            "$set": {
                "amount_paid": round(paid, 2),
                "payment_status": booking_payment_status.value,
                "updated_at": now,
            }
        },
    )
    return await require_booking(booking_oid)


async def set_payment_status(
    booking_oid: ObjectId, status: PaymentStatus, *, actor_id: ObjectId, note: str | None
) -> dict[str, Any]:
    booking = await _raw_booking(booking_oid)
    await mongodb.bookings().update_one(
        {"_id": booking_oid},
        {"$set": {"payment_status": status.value, "updated_at": utcnow()}},
    )
    await _record_history(
        booking_oid,
        booking["status"],
        booking["status"],
        actor_id=actor_id,
        actor_role=Role.ADMIN.value,
        note=f"Payment marked as {status.value}." + (f" {note}" if note else ""),
    )
    return await require_booking(booking_oid)


async def payments_for_booking(booking_oid: ObjectId) -> list[dict[str, Any]]:
    cursor = mongodb.payments().find({"booking_id": booking_oid}).sort("created_at", -1)
    return [serialize(doc) async for doc in cursor]


# ---------------------------------------------------------------------------
# Reads
# ---------------------------------------------------------------------------


async def _raw_booking(booking_oid: ObjectId) -> dict[str, Any]:
    booking = await mongodb.bookings().find_one({"_id": booking_oid})
    if not booking:
        raise NotFoundError("Booking not found.")
    return booking


def _visible_customer(
    customer: dict[str, Any] | None,
    booking: dict[str, Any],
    viewer_role: str | None,
    *,
    hours_before: int = 2,
) -> dict[str, Any] | None:
    """Hide a customer's number from the driver until pickup is close.

    A driver needs the number to find someone at the kerb, not from the moment
    a trip is assigned days earlier. Masking until shortly before pickup keeps
    the roster usable without handing out a customer list.

    Admins and the customer themselves always see it in full — the mask is a
    privacy control against the driver's screen, not a security boundary.
    """
    if not customer:
        return None
    item = serialize(customer)
    if viewer_role != Role.DRIVER.value:
        return item

    scheduled = booking.get("scheduled_at")
    reveal = False
    if scheduled is not None:
        hours_out = (ensure_aware(scheduled) - utcnow()).total_seconds() / 3600
        reveal = hours_out <= hours_before
    # Once the trip is under way the driver plainly needs to reach them.
    if booking.get("status") in {
        BookingStatus.DRIVER_ARRIVING.value,
        BookingStatus.PICKED_UP.value,
        BookingStatus.TRIP_STARTED.value,
    }:
        reveal = True

    if reveal:
        item["phone_visible"] = True
        return item

    phone = str(item.get("phone") or "")
    item["phone"] = f"{phone[:6]}XXXX" if len(phone) > 6 else "XXXXXX"
    item["phone_visible"] = False
    item["phone_available_at"] = (
        f"Customer phone number will be available {hours_before} hours before the pickup time."
    )
    item.pop("email", None)
    item.pop("saved_locations", None)
    return item


async def hydrate(booking: dict[str, Any], *, include_history: bool = False, viewer_role: str | None = None) -> dict[str, Any]:
    item = serialize(booking)
    item["status_label"] = BOOKING_STATUS_LABELS.get(booking["status"], booking["status"])
    item["vehicle_class"] = vehicle_service.vehicle_class(booking["vehicle_type"])

    if booking.get("route_id"):
        route = await mongodb.routes().find_one({"_id": booking["route_id"]})
        item["route"] = serialize(route) if route else None

    customer = await mongodb.users().find_one(
        {"_id": booking["customer_id"]}, {"password_hash": 0}
    )
    reveal_hours = (await settings_service.get_settings()).cancellation.customer_free_hours
    item["customer"] = _visible_customer(
        customer, booking, viewer_role, hours_before=reveal_hours
    )

    # `passenger_phone` is the number the driver actually rings, and it is a
    # field on the booking rather than on the customer record — masking the
    # customer object alone would leave the real number on the driver's screen.
    if viewer_role == Role.DRIVER.value:
        shown = (item.get("customer") or {}).get("phone_visible", True)
        item["passenger_phone_visible"] = bool(shown)
        if not shown:
            raw = str(item.get("passenger_phone") or "")
            item["passenger_phone"] = f"{raw[:6]}XXXX" if len(raw) > 6 else "XXXXXX"
            item["passenger_phone_available_at"] = (
                f"Customer phone number will be available {reveal_hours} hours "
                "before the pickup time."
            )

    if booking.get("driver_id"):
        driver = await mongodb.drivers().find_one({"_id": booking["driver_id"]})
        if driver:
            driver_user = await mongodb.users().find_one(
                {"_id": driver["user_id"]}, {"password_hash": 0}
            )
            item["driver"] = {
                "id": str(driver["_id"]),
                "name": driver_user["name"] if driver_user else None,
                "phone": driver_user["phone"] if driver_user else None,
                "avatar_url": driver_user.get("avatar_url") if driver_user else None,
                "rating_avg": driver.get("rating_avg", 0),
                "rating_count": driver.get("rating_count", 0),
                "total_trips": driver.get("total_trips", 0),
            }
    if booking.get("vehicle_id"):
        vehicle = await mongodb.vehicles().find_one({"_id": booking["vehicle_id"]})
        item["vehicle"] = serialize(vehicle) if vehicle else None

    review = await mongodb.reviews().find_one({"booking_id": booking["_id"]})
    item["review"] = serialize(review) if review else None

    if include_history:
        item["history"] = await get_history(booking["_id"])
        item["payments"] = await payments_for_booking(booking["_id"])
    return item


async def require_booking(
    booking_oid: ObjectId, *, include_history: bool = True, viewer_role: str | None = None
) -> dict[str, Any]:
    booking = await _raw_booking(booking_oid)
    return await hydrate(booking, include_history=include_history, viewer_role=viewer_role)


async def get_for_actor(
    booking_oid: ObjectId, *, user: dict[str, Any], driver: dict[str, Any] | None
) -> dict[str, Any]:
    booking = await _raw_booking(booking_oid)
    role = user["role"]
    if role == Role.CUSTOMER.value and booking["customer_id"] != user["_id"]:
        raise NotFoundError("Booking not found.")
    if role == Role.DRIVER.value:
        if not driver or booking.get("driver_id") != driver["_id"]:
            raise NotFoundError("Booking not found.")
    return await hydrate(booking, include_history=True, viewer_role=role)


def _build_query(filters: dict[str, Any]) -> dict[str, Any]:
    query: dict[str, Any] = {}
    for key in ("status", "payment_status", "trip_type"):
        value = filters.get(key)
        if value:
            query[key] = value.value if hasattr(value, "value") else value
    for key, field in (
        ("driver_id", "driver_id"),
        ("vehicle_id", "vehicle_id"),
        ("route_id", "route_id"),
        ("customer_id", "customer_id"),
    ):
        value = filters.get(key)
        if value:
            query[field] = object_id(value, key)

    date_from, date_to = filters.get("date_from"), filters.get("date_to")
    if date_from or date_to:
        window: dict[str, Any] = {}
        if date_from:
            window["$gte"] = ensure_aware(date_from)
        if date_to:
            window["$lte"] = ensure_aware(date_to)
        query["scheduled_at"] = window

    search = filters.get("search")
    if search:
        pattern = re.escape(search.strip())
        query["$or"] = [
            {"booking_id": {"$regex": pattern, "$options": "i"}},
            {"passenger_name": {"$regex": pattern, "$options": "i"}},
            {"passenger_phone": {"$regex": pattern, "$options": "i"}},
            {"pickup.address": {"$regex": pattern, "$options": "i"}},
            {"drop.address": {"$regex": pattern, "$options": "i"}},
        ]
    return query


async def list_bookings(
    page: int,
    page_size: int,
    *,
    filters: dict[str, Any] | None = None,
    extra_query: dict[str, Any] | None = None,
    sort_field: str = "created_at",
    sort_direction: int = -1,
    viewer_role: str | None = None,
) -> dict[str, Any]:
    query = _build_query(filters or {})
    if extra_query:
        query.update(extra_query)
    total = await mongodb.bookings().count_documents(query)
    cursor = (
        mongodb.bookings()
        .find(query)
        .sort(sort_field, sort_direction)
        .skip((page - 1) * page_size)
        .limit(page_size)
    )
    items = [await hydrate(doc, viewer_role=viewer_role) async for doc in cursor]
    return build_page(items, total, page, page_size)


async def customer_buckets(customer_id: ObjectId) -> dict[str, int]:
    pipeline = [
        {"$match": {"customer_id": customer_id}},
        {"$group": {"_id": "$status", "count": {"$sum": 1}}},
    ]
    counts = {doc["_id"]: doc["count"] async for doc in mongodb.bookings().aggregate(pipeline)}
    return {
        "upcoming": counts.get(BookingStatus.REQUESTED.value, 0)
        + counts.get(BookingStatus.CONFIRMED.value, 0),
        "active": sum(counts.get(status.value, 0) for status in ACTIVE_BOOKING_STATUSES),
        "completed": counts.get(BookingStatus.COMPLETED.value, 0),
        "cancelled": counts.get(BookingStatus.CANCELLED.value, 0),
        "total": sum(counts.values()),
    }
