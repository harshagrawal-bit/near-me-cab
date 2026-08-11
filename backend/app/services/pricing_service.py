"""Fare engine.

The backend is the only place a price is ever produced. Clients ask for a
quote and later submit a booking describing *what* they want; the fare is
recomputed server-side at booking time and the client's number is ignored
entirely.

Strategy: `fixed_fare` (MVP route-based pricing) wins when present, otherwise
`base_fare + per_km_rate * distance` is used. Adding a distance/duration-based
dynamic strategy later means adding a branch in `_compute_components` — no
caller changes.
"""

from __future__ import annotations

import datetime as dt
from typing import Any

from bson import ObjectId
from pymongo.errors import DuplicateKeyError

from app.core.errors import ConflictError, NotFoundError, ValidationError
from app.core.timezone import local_hour
from app.db import mongodb
from app.models.enums import TripType, VehicleType
from app.schemas.admin import PricingSettings
from app.schemas.booking import FareBreakdown
from app.schemas.common import ensure_aware, serialize, utcnow
from app.schemas.fleet import PricingUpdate, PricingUpsert
from app.services import coupon_service, route_service, settings_service, vehicle_service


def _round_rupees(value: float) -> float:
    """Indian cab fares are quoted in whole rupees."""
    return float(round(value + 1e-9))


def _multiplier_for(trip_type: TripType, config: PricingSettings) -> float:
    return {
        TripType.ONE_WAY: config.one_way_multiplier,
        TripType.ROUND_TRIP: config.round_trip_multiplier,
        TripType.LOCAL: config.local_multiplier,
        TripType.AIRPORT: config.airport_multiplier,
    }[trip_type]


def _is_night(when: dt.datetime | None, config: PricingSettings) -> bool:
    if when is None:
        return False
    # Compare in the operator's local wall-clock time. Using UTC here would
    # bill a 9 AM IST pickup as a night trip, since that is 03:30 UTC.
    hour = local_hour(ensure_aware(when), config.timezone)
    # Night window may wrap past midnight (e.g. 22:00 → 05:00).
    if config.night_start_hour <= config.night_end_hour:
        return config.night_start_hour <= hour < config.night_end_hour
    return hour >= config.night_start_hour or hour < config.night_end_hour


def _compute_components(
    price: dict[str, Any], route: dict[str, Any]
) -> tuple[float, float]:
    """Return (base_fare, distance_charge) for the active strategy."""
    fixed = price.get("fixed_fare")
    if fixed is not None:
        return float(fixed), 0.0
    distance = float(route.get("distance_km") or 0)
    per_km = float(price.get("per_km_rate") or 0)
    return float(price.get("base_fare") or 0), per_km * distance


def calculate_fare(
    *,
    price: dict[str, Any],
    route: dict[str, Any],
    trip_type: TripType,
    scheduled_at: dt.datetime | None,
    config: PricingSettings,
    discount: float = 0.0,
) -> FareBreakdown:
    base_fare, distance_charge = _compute_components(price, route)
    driver_allowance = float(price.get("driver_allowance") or 0)
    toll = float(price.get("toll") or 0)
    additional = float(price.get("additional_charges") or 0)

    multiplier = _multiplier_for(trip_type, config)
    night = float(price.get("night_surcharge") or 0) if _is_night(scheduled_at, config) else 0.0
    airport = float(price.get("airport_surcharge") or 0) if trip_type == TripType.AIRPORT else 0.0

    # The multiplier applies to the travel component only — allowances,
    # tolls and surcharges are already trip-level amounts.
    travel = (base_fare + distance_charge) * multiplier
    subtotal = travel + driver_allowance + toll + night + airport + additional

    capped_discount = min(max(discount, 0.0), subtotal)
    taxable = subtotal - capped_discount
    tax = taxable * (config.tax_percent / 100.0)
    total = _round_rupees(taxable + tax)

    return FareBreakdown(
        base_fare=_round_rupees(base_fare * multiplier),
        distance_charge=_round_rupees(distance_charge * multiplier),
        driver_allowance=_round_rupees(driver_allowance),
        toll=_round_rupees(toll),
        night_surcharge=_round_rupees(night),
        airport_surcharge=_round_rupees(airport),
        additional_charges=_round_rupees(additional),
        trip_type_multiplier=multiplier,
        subtotal=_round_rupees(subtotal),
        discount=_round_rupees(capped_discount),
        tax=_round_rupees(tax),
        total=total,
        currency=config.currency,
    )


async def resolve_route(
    *, route_id: str | None, pickup: str | None, drop: str | None
) -> dict[str, Any]:
    if route_id:
        from app.schemas.common import object_id

        return await route_service.require_active_route(object_id(route_id, "route_id"))
    route = await route_service.find_by_places(pickup or "", drop or "")
    if not route:
        raise NotFoundError(
            f"We do not run a scheduled route from {pickup} to {drop} yet. "
            "Pick one of our listed routes or contact support for a custom quote."
        )
    return route


async def prices_for_route(route_id: ObjectId) -> list[dict[str, Any]]:
    cursor = mongodb.pricing().find({"route_id": route_id, "is_active": True})
    return [doc async for doc in cursor]


async def price_for(route_id: ObjectId, vehicle_type: str) -> dict[str, Any] | None:
    return await mongodb.pricing().find_one(
        {"route_id": route_id, "vehicle_type": vehicle_type, "is_active": True}
    )


async def quote(
    *,
    route_id: str | None,
    pickup: str | None,
    drop: str | None,
    trip_type: TripType,
    vehicle_type: VehicleType | None,
    scheduled_at: dt.datetime | None,
    coupon_code: str | None,
) -> dict[str, Any]:
    """Build the fare options screen: one row per priced vehicle class."""
    route = await resolve_route(route_id=route_id, pickup=pickup, drop=drop)
    config = (await settings_service.get_settings()).pricing
    prices = await prices_for_route(route["_id"])
    if vehicle_type:
        prices = [p for p in prices if p["vehicle_type"] == vehicle_type.value]
    if not prices:
        raise NotFoundError("Pricing has not been published for this route yet.")

    fleet_counts = await vehicle_service.count_available_by_type()

    coupon = None
    if coupon_code:
        coupon = await coupon_service.get_active(coupon_code)

    options: list[dict[str, Any]] = []
    for price in prices:
        gross = calculate_fare(
            price=price,
            route=route,
            trip_type=trip_type,
            scheduled_at=scheduled_at,
            config=config,
        )
        discount = (
            coupon_service.discount_for(coupon, gross.subtotal) if coupon else 0.0
        )
        breakdown = calculate_fare(
            price=price,
            route=route,
            trip_type=trip_type,
            scheduled_at=scheduled_at,
            config=config,
            discount=discount,
        )
        meta = vehicle_service.vehicle_class(price["vehicle_type"])
        options.append(
            {
                "vehicle_type": price["vehicle_type"],
                "label": meta["label"],
                "seating_capacity": meta["seating_capacity"],
                "description": meta["description"],
                "available_vehicles": fleet_counts.get(price["vehicle_type"], 0),
                "fare": breakdown.total,
                "breakdown": breakdown.model_dump(),
                "_order": meta["order"],
            }
        )
    options.sort(key=lambda option: option.pop("_order"))

    return {
        "route": serialize(route),
        "trip_type": trip_type.value,
        "scheduled_at": serialize(scheduled_at),
        "coupon": coupon_service.to_public(coupon) if coupon else None,
        "options": options,
    }


async def quote_for_booking(
    *,
    route: dict[str, Any],
    vehicle_type: VehicleType,
    trip_type: TripType,
    scheduled_at: dt.datetime,
    coupon_code: str | None,
) -> tuple[FareBreakdown, dict[str, Any] | None]:
    """Authoritative fare used when a booking is actually created."""
    price = await price_for(route["_id"], vehicle_type.value)
    if not price:
        raise NotFoundError(
            f"{vehicle_service.vehicle_class(vehicle_type.value)['label']} is not available "
            "on this route."
        )
    config = (await settings_service.get_settings()).pricing

    gross = calculate_fare(
        price=price, route=route, trip_type=trip_type, scheduled_at=scheduled_at, config=config
    )
    coupon = await coupon_service.get_active(coupon_code) if coupon_code else None
    if coupon_code and not coupon:
        raise ValidationError("This coupon code is not valid or has expired.")

    discount = 0.0
    if coupon:
        if gross.subtotal < float(coupon.get("min_booking_value") or 0):
            raise ValidationError(
                f"This coupon needs a minimum booking value of "
                f"₹{int(coupon['min_booking_value'])}."
            )
        discount = coupon_service.discount_for(coupon, gross.subtotal)

    breakdown = calculate_fare(
        price=price,
        route=route,
        trip_type=trip_type,
        scheduled_at=scheduled_at,
        config=config,
        discount=discount,
    )
    return breakdown, coupon


# ---------------------------------------------------------------------------
# Admin CRUD
# ---------------------------------------------------------------------------


async def upsert_price(payload: PricingUpsert) -> dict[str, Any]:
    from app.schemas.common import object_id

    route_oid = object_id(payload.route_id, "route_id")
    if not await route_service.get_route(route_oid):
        raise NotFoundError("Route not found.")

    data = payload.model_dump()
    data["route_id"] = route_oid
    data["vehicle_type"] = payload.vehicle_type.value
    data["updated_at"] = utcnow()
    try:
        await mongodb.pricing().update_one(
            {"route_id": route_oid, "vehicle_type": data["vehicle_type"]},
            {"$set": data, "$setOnInsert": {"created_at": utcnow()}},
            upsert=True,
        )
    except DuplicateKeyError:
        raise ConflictError("A price already exists for this route and vehicle type.")
    doc = await mongodb.pricing().find_one(
        {"route_id": route_oid, "vehicle_type": data["vehicle_type"]}
    )
    return serialize(doc)


async def update_price(price_id: ObjectId, payload: PricingUpdate) -> dict[str, Any]:
    changes = payload.model_dump(exclude_unset=True)
    changes = {k: v for k, v in changes.items() if v is not None}
    if changes:
        changes["updated_at"] = utcnow()
        result = await mongodb.pricing().update_one({"_id": price_id}, {"$set": changes})
        if result.matched_count == 0:
            raise NotFoundError("Price not found.")
    doc = await mongodb.pricing().find_one({"_id": price_id})
    if not doc:
        raise NotFoundError("Price not found.")
    return serialize(doc)


async def delete_price(price_id: ObjectId) -> None:
    result = await mongodb.pricing().delete_one({"_id": price_id})
    if result.deleted_count == 0:
        raise NotFoundError("Price not found.")


async def list_prices(route_id: ObjectId | None = None) -> list[dict[str, Any]]:
    """Prices grouped per route, ready for the admin pricing grid."""
    query = {"route_id": route_id} if route_id else {}
    cursor = mongodb.pricing().find(query)
    prices = [doc async for doc in cursor]

    route_ids = list({doc["route_id"] for doc in prices})
    if route_id and route_id not in route_ids:
        route_ids.append(route_id)
    routes_cursor = mongodb.routes().find({"_id": {"$in": route_ids}})
    routes = {doc["_id"]: doc async for doc in routes_cursor}

    grouped: dict[str, dict[str, Any]] = {}
    for doc in prices:
        route = routes.get(doc["route_id"])
        if not route:
            continue
        key = str(doc["route_id"])
        grouped.setdefault(
            key,
            {"route": serialize(route), "prices": []},
        )
        item = serialize(doc)
        item["class_info"] = vehicle_service.vehicle_class(doc["vehicle_type"])
        grouped[key]["prices"].append(item)

    for group in grouped.values():
        group["prices"].sort(key=lambda p: p["class_info"]["order"])
    return sorted(grouped.values(), key=lambda g: g["route"]["name"])
