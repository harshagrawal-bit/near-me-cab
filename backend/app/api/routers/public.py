"""Public, no-login endpoints for the marketing website.

The website has no accounts, but its bookings have to land in the same
database the app and the admin console read — otherwise operations would have
two inboxes and drivers would never see half the work.

So a booking made here creates (or reuses) a lightweight customer keyed on the
phone number, then goes through exactly the same `booking_service` path a
signed-in customer does. Every rule the app enforces — the fare engine, the
advance, auto-confirm, auto-assign — applies identically, because none of it
is reimplemented here.

Two things are deliberately not exposed: anything that reads other people's
data, and anything that takes money. A guest booking settles with the driver;
paying online needs an account, and inventing a payment session for someone we
cannot authenticate is not worth the attack surface.
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, Query

from app.core.errors import NotFoundError
from app.core.rate_limit import public_rate_limit
from app.db import mongodb
from app.models.enums import AccountStatus, Role
from app.schemas.booking import BookingCreate, QuoteRequest
from app.schemas.common import serialize, utcnow
from app.schemas.public import PublicBookingRequest
from app.services import (
    booking_service,
    maps_service,
    pricing_service,
    route_service,
    settings_service,
)

logger = logging.getLogger("localride.public")

router = APIRouter(prefix="/public", tags=["public"])


@router.get("/company", dependencies=[Depends(public_rate_limit)], summary="Company details for the website")
async def company() -> dict:
    settings = await settings_service.get_settings()
    return {
        "company": settings.company.model_dump(),
        "cancellation": settings.cancellation.model_dump(),
        "payment_options": settings.payment_options.model_dump(),
        "advance": {"percent": settings.advance.percent, "enabled": settings.advance.enabled},
    }


@router.get("/routes", dependencies=[Depends(public_rate_limit)], summary="Routes we operate")
async def routes(limit: int = Query(60, ge=1, le=200)) -> dict:
    page = await route_service.list_routes(1, limit, is_active=True)
    return {
        "items": [
            {
                "id": item["id"],
                "name": item["name"],
                "origin": item["origin"],
                "destination": item["destination"],
                "distance_km": item.get("distance_km"),
                "duration_minutes": item.get("duration_minutes"),
            }
            for item in page["items"]
        ]
    }


@router.get("/places", dependencies=[Depends(public_rate_limit)], summary="Place suggestions for the booking form")
async def places(q: str = Query("", max_length=60)) -> list[dict]:
    return await maps_service.suggest_places(q)


@router.get("/vehicle-classes", dependencies=[Depends(public_rate_limit)], summary="Vehicle classes offered")
async def vehicle_classes() -> list[dict]:
    from app.services import vehicle_service

    return vehicle_service.list_vehicle_classes()


@router.post(
    "/quote",
    dependencies=[Depends(public_rate_limit)],
    summary="Fare estimate, no account needed",
)
async def quote(payload: QuoteRequest) -> dict:
    """Same engine the app uses. The client still never supplies a price."""
    return await pricing_service.quote(
        route_id=payload.route_id,
        pickup=payload.pickup,
        drop=payload.drop,
        trip_type=payload.trip_type,
        vehicle_type=payload.vehicle_type,
        scheduled_at=payload.scheduled_at,
        coupon_code=payload.coupon_code,
    )


@router.post(
    "/bookings",
    status_code=201,
    dependencies=[Depends(public_rate_limit)],
    summary="Book a trip without an account",
)
async def create_booking(payload: PublicBookingRequest) -> dict:
    """Create the booking against a customer identified by phone number.

    Reusing an existing customer rather than making a new one each time means a
    regular caller builds one history the office can see, instead of a dozen
    disconnected records that look like a dozen different people.
    """
    customer = await _customer_for(payload)

    booking = await booking_service.create_booking(
        customer,
        BookingCreate(
            route_id=payload.route_id,
            pickup={"address": payload.pickup},
            drop={"address": payload.drop},
            trip_type=payload.trip_type,
            vehicle_type=payload.vehicle_type,
            scheduled_at=payload.scheduled_at,
            passenger_count=payload.passenger_count,
            passenger_name=payload.name,
            passenger_phone=payload.phone,
            notes=payload.notes,
            # A guest cannot pay online — there is no session to attach a
            # payment to — so the fare settles with the driver and the office
            # takes it from there.
            payment_option="pay_later",
        ),
    )
    logger.info("Website booking %s for %s", booking["booking_id"], payload.phone)
    return {
        "booking_id": booking["booking_id"],
        "status": booking["status"],
        "status_label": booking.get("status_label"),
        "total_fare": booking.get("total_fare"),
        "scheduled_at": booking.get("scheduled_at"),
        "message": "We have your request. Our team will call you to confirm.",
    }


@router.get("/bookings/{reference}", dependencies=[Depends(public_rate_limit)], summary="Check a booking without logging in")
async def track(reference: str, phone: str = Query(..., min_length=10, max_length=15)) -> dict:
    """Look up one booking by its reference *and* the phone that made it.

    Requiring both is what stops this being a way to read strangers' trips by
    guessing sequential references.
    """
    digits = "".join(ch for ch in phone if ch.isdigit())[-10:]
    # A phone of letters normalises to "", which matched the empty stored phone
    # of every Google sign-up and every closed account — turning a sequential
    # reference into a readable booking for anyone who guessed it.
    if len(digits) != 10:
        raise NotFoundError("No booking with that reference.")

    booking = await mongodb.bookings().find_one({"booking_id": reference.strip().upper()})
    if not booking:
        raise NotFoundError("No booking with that reference.")

    customer = await mongodb.users().find_one({"_id": booking["customer_id"]}, {"phone": 1})
    stored = "".join(ch for ch in str((customer or {}).get("phone") or "") if ch.isdigit())[-10:]
    booked_phone = "".join(ch for ch in str(booking.get("passenger_phone") or "") if ch.isdigit())[-10:]
    # Falsy entries stripped: an absent stored phone must never match.
    if digits not in {p for p in (stored, booked_phone) if p}:
        # Same message as a missing reference, so a wrong phone cannot be used
        # to confirm that a reference exists.
        raise NotFoundError("No booking with that reference.")

    return {
        "booking_id": booking["booking_id"],
        "status": booking["status"],
        "scheduled_at": booking.get("scheduled_at"),
        "pickup": (booking.get("pickup") or {}).get("address"),
        "drop": (booking.get("drop") or {}).get("address"),
        "total_fare": booking.get("total_fare"),
        "vehicle_type": booking.get("vehicle_type"),
    }


async def _customer_for(payload: PublicBookingRequest) -> dict:
    """Find the customer behind this phone number, or create one.

    The account has no password: it exists so the booking has an owner and the
    office has one thread per caller. If that person later signs up with the
    same phone, registration will refuse the duplicate — which is the right
    outcome, and support can merge it.
    """
    digits = "".join(ch for ch in payload.phone if ch.isdigit())[-10:]
    existing = await mongodb.users().find_one({"phone": digits, "role": Role.CUSTOMER.value})
    if existing:
        return existing

    now = utcnow()
    document = {
        "name": payload.name,
        "email": payload.email or f"web-{digits}@guest.invalid",
        "phone": digits,
        # No usable password: this account cannot be signed into until the
        # person registers properly.
        "password_hash": "!website",
        "role": Role.CUSTOMER.value,
        "status": AccountStatus.ACTIVE.value,
        "source": "website",
        "avatar_url": None,
        "saved_locations": [],
        "created_at": now,
        "updated_at": now,
        "last_login_at": None,
    }
    result = await mongodb.users().insert_one(document)
    document["_id"] = result.inserted_id
    return document
