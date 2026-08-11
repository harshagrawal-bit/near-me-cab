"""Seed the database with realistic demo data.

    python -m scripts.seed          # create anything missing, keep existing data
    python -m scripts.seed --reset  # drop the collections first

Everything here is fictional demo data — no real payment credentials, no real
customer records.
"""

from __future__ import annotations

import argparse
import asyncio
import datetime as dt
import random
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.core.config import settings  # noqa: E402
from app.core.security import hash_password  # noqa: E402
from app.db import mongodb  # noqa: E402
from app.db.indexes import ensure_indexes  # noqa: E402
from app.db.mongodb import Collections, close_mongo_connection, connect_to_mongo  # noqa: E402
from app.models.enums import (  # noqa: E402
    AccountStatus,
    BookingStatus,
    DiscountType,
    DocumentStatus,
    DriverStatus,
    DriverType,
    NotificationType,
    PaymentMethod,
    PaymentStatus,
    Role,
    TripType,
    VehicleStatus,
    VehicleType,
    VerificationStatus,
)
from app.schemas.admin import SettingsPayload  # noqa: E402

RNG = random.Random(20260801)


def now() -> dt.datetime:
    return dt.datetime.now(dt.timezone.utc)


# ---------------------------------------------------------------------------
# Reference data
# ---------------------------------------------------------------------------

ROUTES = [
    # origin, destination, km, minutes, sedan, suv, premium, tempo
    ("Pune", "Mumbai", 150, 210, 3000, 4000, 4500, 6500),
    ("Mumbai", "Pune", 150, 210, 3000, 4000, 4500, 6500),
    ("Pune", "Nashik", 210, 270, 3800, 4800, 5400, 7600),
    ("Pune", "Goa", 440, 540, 8500, 10500, 12000, 16000),
    ("Pune", "Shirdi", 185, 240, 3400, 4300, 4900, 7000),
    ("Pune", "Mahabaleshwar", 120, 180, 2600, 3400, 3900, 5600),
    ("Pune", "Kolhapur", 235, 285, 4200, 5300, 5900, 8200),
    ("Pune", "Lonavala", 65, 90, 1600, 2100, 2500, 3600),
    ("Pune", "Aurangabad", 235, 300, 4300, 5400, 6000, 8400),
    ("Pune", "Solapur", 250, 300, 4400, 5500, 6200, 8600),
    ("Mumbai", "Nashik", 165, 220, 3200, 4100, 4700, 6800),
    ("Mumbai", "Shirdi", 245, 300, 4400, 5500, 6100, 8500),
    # Airport transfers
    ("Pune", "Pune Airport", 12, 35, 700, 950, 1300, 2200),
    ("Pune", "Mumbai Airport", 160, 225, 3400, 4400, 5000, 7000),
    ("Mumbai", "Mumbai Airport", 20, 45, 800, 1100, 1500, 2500),
    # Local packages
    ("Pune", "Pune Local (8 hrs / 80 km)", 80, 480, 2200, 2900, 3400, 4800),
    ("Mumbai", "Mumbai Local (8 hrs / 80 km)", 80, 480, 2500, 3200, 3800, 5200),
]

VEHICLES = [
    (VehicleType.SEDAN, "Maruti Suzuki Dzire", "MH12AB1234", 4, True),
    (VehicleType.SEDAN, "Honda Amaze", "MH12CD5678", 4, True),
    (VehicleType.SEDAN, "Hyundai Aura", "MH14EF4321", 4, True),
    (VehicleType.SUV, "Maruti Suzuki Ertiga", "MH12GH9012", 6, True),
    (VehicleType.SUV, "Mahindra XUV700", "MH14IJ3456", 6, True),
    (VehicleType.PREMIUM, "Toyota Innova Crysta", "MH12KL7890", 6, True),
    (VehicleType.PREMIUM, "Toyota Innova Hycross", "MH01MN2345", 6, True),
    (VehicleType.HATCHBACK, "Maruti Suzuki Swift", "MH12OP6789", 4, True),
    (VehicleType.TEMPO, "Force Tempo Traveller", "MH14QR1122", 12, True),
    (VehicleType.SUV, "Maruti Suzuki Ertiga", "MH12ST3344", 6, False),
]

DRIVERS = [
    ("Sandeep Kulkarni", "sandeep.kulkarni@localride.in", "9822011001", "MH1220190001234"),
    ("Ravi Pawar", "ravi.pawar@localride.in", "9822011002", "MH1220180005678"),
    ("Imran Shaikh", "imran.shaikh@localride.in", "9822011003", "MH1420200009012"),
    ("Ganesh Jadhav", "ganesh.jadhav@localride.in", "9822011004", "MH1220170003456"),
    ("Vikram Deshmukh", "vikram.deshmukh@localride.in", "9822011005", "MH0120210007890"),
    ("Prakash More", "prakash.more@localride.in", "9822011006", "MH1220160001122"),
]

CUSTOMERS = [
    ("Aarti Joshi", "aarti.joshi@example.com", "9860022001"),
    ("Rohit Sharma", "rohit.sharma@example.com", "9860022002"),
    ("Sneha Patil", "sneha.patil@example.com", "9860022003"),
    ("Kunal Mehta", "kunal.mehta@example.com", "9860022004"),
    ("Fatima Ansari", "fatima.ansari@example.com", "9860022005"),
    ("Nikhil Rane", "nikhil.rane@example.com", "9860022006"),
]

DEMO_PASSWORD = "Password@123"

COUPONS = [
    {
        "code": "FIRST10",
        "description": "10% off your first ride, up to ₹500",
        "discount_type": DiscountType.PERCENT.value,
        "discount_value": 10,
        "min_booking_value": 1000,
        "max_discount": 500,
        "usage_limit": 500,
    },
    {
        "code": "PUNEMUM300",
        "description": "Flat ₹300 off on Pune ↔ Mumbai trips",
        "discount_type": DiscountType.FLAT.value,
        "discount_value": 300,
        "min_booking_value": 2500,
        "max_discount": None,
        "usage_limit": 200,
    },
    {
        "code": "WEEKEND5",
        "description": "5% off weekend outstation trips",
        "discount_type": DiscountType.PERCENT.value,
        "discount_value": 5,
        "min_booking_value": 2000,
        "max_discount": 400,
        "usage_limit": None,
    },
]

PICKUP_POINTS = [
    "Katraj Chowk, Satara Road, Pune",
    "Baner Road, Near Balewadi Stadium, Pune",
    "Kharadi Bypass, Pune",
    "Hinjewadi Phase 1, Pune",
    "Viman Nagar, Pune",
    "Kothrud Depot, Pune",
]
DROP_POINTS = [
    "Bandra Kurla Complex, Mumbai",
    "Andheri East, Mumbai",
    "Sai Baba Temple, Shirdi",
    "Panchgani Road, Mahabaleshwar",
    "Calangute Beach, Goa",
    "College Road, Nashik",
]


# ---------------------------------------------------------------------------
# Seeding
# ---------------------------------------------------------------------------


async def reset_collections() -> None:
    db = mongodb.get_db()
    for name in vars(Collections).values():
        if isinstance(name, str) and not name.startswith("_"):
            await db[name].delete_many({})
    await db["support_requests"].delete_many({})
    print("  cleared all collections")


async def seed_settings() -> None:
    payload = SettingsPayload()
    payload.company.legal_name = "NearMe Cab"
    payload.company.support_email = "support@nearmecab.in"
    payload.company.support_phone = "9000000000"
    payload.company.whatsapp_number = "9000000000"
    payload.company.address = "Katraj Chowk, Satara Road, Pune 411046, Maharashtra"
    payload.company.working_hours = "24x7"
    await mongodb.admin_settings().update_one(
        {"key": "global"},
        {
            "$set": {**payload.model_dump(), "updated_at": now()},
            "$setOnInsert": {"key": "global", "created_at": now()},
        },
        upsert=True,
    )
    print("  settings ready")


async def upsert_user(name: str, email: str, phone: str, role: Role, password: str):
    existing = await mongodb.users().find_one({"email": email})
    if existing:
        return existing
    document = {
        "name": name,
        "email": email,
        "phone": phone,
        "password_hash": hash_password(password),
        "role": role.value,
        "status": AccountStatus.ACTIVE.value,
        "avatar_url": None,
        "saved_locations": [],
        "created_at": now(),
        "updated_at": now(),
        "last_login_at": None,
    }
    result = await mongodb.users().insert_one(document)
    document["_id"] = result.inserted_id
    return document


async def seed_admin():
    admin = await upsert_user(
        "Operations Admin",
        settings.SEED_ADMIN_EMAIL,
        "9000000001",
        Role.ADMIN,
        settings.SEED_ADMIN_PASSWORD,
    )
    print(f"  admin: {admin['email']}")
    return admin


async def seed_routes():
    from app.services.route_service import default_name, place_key

    created = 0
    routes = []
    for origin, destination, km, minutes, *_ in ROUTES:
        existing = await mongodb.routes().find_one(
            {"origin_key": place_key(origin), "destination_key": place_key(destination)}
        )
        if existing:
            routes.append(existing)
            continue
        document = {
            "origin": origin,
            "destination": destination,
            "origin_key": place_key(origin),
            "destination_key": place_key(destination),
            "name": default_name(origin, destination),
            "distance_km": float(km),
            "duration_minutes": int(minutes),
            "is_active": True,
            "created_at": now(),
            "updated_at": now(),
        }
        result = await mongodb.routes().insert_one(document)
        document["_id"] = result.inserted_id
        routes.append(document)
        created += 1
    print(f"  routes: {len(routes)} total ({created} new)")
    return routes


async def seed_pricing(routes):
    by_key = {(r["origin"], r["destination"]): r for r in routes}
    created = 0
    for origin, destination, km, _minutes, sedan, suv, premium, tempo in ROUTES:
        route = by_key.get((origin, destination))
        if not route:
            continue
        is_airport = "airport" in destination.lower()
        prices = {
            VehicleType.HATCHBACK.value: round(sedan * 0.82 / 10) * 10,
            VehicleType.SEDAN.value: sedan,
            VehicleType.SUV.value: suv,
            VehicleType.PREMIUM.value: premium,
            VehicleType.TEMPO.value: tempo,
        }
        for vehicle_type, fare in prices.items():
            document = {
                "route_id": route["_id"],
                "vehicle_type": vehicle_type,
                "fixed_fare": float(fare),
                # Populated so the distance strategy has sensible values to
                # fall back on if `fixed_fare` is later cleared.
                "base_fare": round(fare * 0.25, 2),
                "per_km_rate": round(fare * 0.75 / max(km, 1), 2),
                "driver_allowance": 0.0,
                "toll": 0.0,
                "night_surcharge": 250.0,
                "airport_surcharge": 150.0 if is_airport else 0.0,
                "additional_charges": 0.0,
                "is_active": True,
                "updated_at": now(),
            }
            result = await mongodb.pricing().update_one(
                {"route_id": route["_id"], "vehicle_type": vehicle_type},
                {"$set": document, "$setOnInsert": {"created_at": now()}},
                upsert=True,
            )
            created += 1 if result.upserted_id else 0
    print(f"  pricing rows: {created} new")


async def seed_vehicles():
    vehicles = []
    created = 0
    for vehicle_type, model, registration, seats, is_ac in VEHICLES:
        existing = await mongodb.vehicles().find_one({"registration_number": registration})
        if existing:
            vehicles.append(existing)
            continue
        document = {
            "vehicle_type": vehicle_type.value,
            "model": model,
            "registration_number": registration,
            "seating_capacity": seats,
            "is_ac": is_ac,
            "status": VehicleStatus.AVAILABLE.value,
            "assigned_driver_id": None,
            # Filled in below once drivers exist, so each seeded car belongs to
            # the fleet owner who drives it and shows up in their vehicle list.
            "owner_driver_id": None,
            "notes": None,
            "created_at": now(),
            "updated_at": now(),
        }
        result = await mongodb.vehicles().insert_one(document)
        document["_id"] = result.inserted_id
        vehicles.append(document)
        created += 1
    print(f"  vehicles: {len(vehicles)} total ({created} new)")
    return vehicles


async def seed_drivers(vehicles):
    drivers = []
    created = 0
    for index, (name, email, phone, licence) in enumerate(DRIVERS):
        user = await upsert_user(name, email, phone, Role.DRIVER, DEMO_PASSWORD)
        existing = await mongodb.drivers().find_one({"user_id": user["_id"]})
        if existing:
            drivers.append(existing)
            continue

        vehicle = vehicles[index] if index < len(vehicles) else None
        # One driver is left pending verification so the admin queue is not empty.
        verified = index < len(DRIVERS) - 1
        licence_expiry = now() + dt.timedelta(days=365 * 2 + index * 40)
        documents = [
            {
                "type": "Driving Licence",
                "number": licence,
                "status": (
                    DocumentStatus.VERIFIED.value if verified else DocumentStatus.PENDING.value
                ),
                "expires_on": licence_expiry,
                "file_url": None,
            },
            {
                "type": "Aadhaar Card",
                "number": f"XXXX-XXXX-{1000 + index}",
                "status": (
                    DocumentStatus.VERIFIED.value if verified else DocumentStatus.PENDING.value
                ),
                "expires_on": None,
                "file_url": None,
            },
            {
                "type": "Vehicle Insurance",
                "number": f"INS-{2026000 + index}",
                # Deliberately expired on one driver to exercise the expiry badge.
                "status": (
                    DocumentStatus.EXPIRED.value if index == 2 else DocumentStatus.VERIFIED.value
                ),
                "expires_on": now() - dt.timedelta(days=20)
                if index == 2
                else now() + dt.timedelta(days=200 + index * 15),
                "file_url": None,
            },
        ]
        document = {
            "user_id": user["_id"],
            # Seeded drivers are fleet owners who drive their own trips — the
            # commonest real shape for an operator this size.
            "driver_type": DriverType.OWNER.value,
            "owner_id": None,
            "licence_number": licence,
            "licence_expiry": licence_expiry,
            "verification_status": (
                VerificationStatus.VERIFIED.value if verified else VerificationStatus.PENDING.value
            ),
            "status": DriverStatus.ACTIVE.value,
            "is_available": verified and index % 3 != 2,
            "assigned_vehicle_id": vehicle["_id"] if vehicle else None,
            "documents": documents,
            # Funded above the ₹800 floor so the demo can accept trips without
            # a manual top-up first. Unverified drivers start empty.
            "wallet_balance": 5000.0 if verified else 0.0,
            "wallet_held": 0.0,
            "rating_avg": 0.0,
            "rating_count": 0,
            "total_trips": 0,
            "created_at": now(),
            "updated_at": now(),
        }
        result = await mongodb.drivers().insert_one(document)
        document["_id"] = result.inserted_id
        if vehicle:
            await mongodb.vehicles().update_one(
                {"_id": vehicle["_id"]},
                {
                    "$set": {
                        "assigned_driver_id": result.inserted_id,
                        # Ownership, not just assignment — this is what makes the
                        # car appear under "My vehicles" and be selectable when
                        # the owner accepts a trip.
                        "owner_driver_id": result.inserted_id,
                        "status": VehicleStatus.ASSIGNED.value,
                    }
                },
            )
        drivers.append(document)
        created += 1
    print(f"  drivers: {len(drivers)} total ({created} new)")
    return drivers


async def seed_customers():
    customers = []
    for name, email, phone in CUSTOMERS:
        user = await upsert_user(name, email, phone, Role.CUSTOMER, DEMO_PASSWORD)
        customers.append(user)
    await mongodb.users().update_one(
        {"_id": customers[0]["_id"]},
        {
            "$set": {
                "saved_locations": [
                    {
                        "label": "Home",
                        "address": "Lane 5, Koregaon Park, Pune",
                        "lat": None,
                        "lng": None,
                    },
                    {
                        "label": "Office",
                        "address": "Magarpatta City, Hadapsar, Pune",
                        "lat": None,
                        "lng": None,
                    },
                ]
            }
        },
    )
    print(f"  customers: {len(customers)} total")
    return customers


async def seed_coupons():
    created = 0
    for coupon in COUPONS:
        result = await mongodb.coupons().update_one(
            {"code": coupon["code"]},
            {
                "$set": {
                    **coupon,
                    "expires_at": now() + dt.timedelta(days=90),
                    "is_active": True,
                    "updated_at": now(),
                },
                "$setOnInsert": {"used_count": 0, "created_at": now()},
            },
            upsert=True,
        )
        created += 1 if result.upserted_id else 0
    print(f"  coupons: {len(COUPONS)} total ({created} new)")


async def _history(booking_id, transitions, actor_id, actor_role):
    from app.models.enums import BOOKING_STATUS_LABELS

    previous = None
    for status_value, timestamp, note in transitions:
        await mongodb.booking_status_history().insert_one(
            {
                "booking_id": booking_id,
                "from_status": previous,
                "to_status": status_value,
                "label": BOOKING_STATUS_LABELS.get(status_value, status_value),
                "changed_by": actor_id,
                "changed_by_role": actor_role,
                "note": note,
                "created_at": timestamp,
            }
        )
        previous = status_value


async def seed_bookings(customers, drivers, vehicles, routes):
    if await mongodb.bookings().count_documents({}) > 0:
        print("  bookings: already present, skipping")
        return

    from app.schemas.admin import SettingsPayload as SP
    from app.services.pricing_service import calculate_fare

    config = SP().pricing
    verified_drivers = [d for d in drivers if d["verification_status"] == VerificationStatus.VERIFIED.value]
    today = now().replace(hour=0, minute=0, second=0, microsecond=0)

    # (days_offset, hour, status) — a realistic spread across the pipeline.
    plan = [
        (-24, 7, BookingStatus.COMPLETED),
        (-21, 16, BookingStatus.COMPLETED),
        (-18, 6, BookingStatus.COMPLETED),
        (-15, 9, BookingStatus.CANCELLED),
        (-12, 5, BookingStatus.COMPLETED),
        (-9, 19, BookingStatus.COMPLETED),
        (-7, 8, BookingStatus.COMPLETED),
        (-5, 14, BookingStatus.COMPLETED),
        (-4, 6, BookingStatus.CANCELLED),
        (-3, 10, BookingStatus.COMPLETED),
        (-2, 7, BookingStatus.COMPLETED),
        (-1, 20, BookingStatus.COMPLETED),
        (0, 9, BookingStatus.TRIP_STARTED),
        (0, 13, BookingStatus.DRIVER_ARRIVING),
        (0, 17, BookingStatus.ACCEPTED),
        (0, 21, BookingStatus.DRIVER_ASSIGNED),
        (1, 6, BookingStatus.CONFIRMED),
        (1, 11, BookingStatus.CONFIRMED),
        (2, 5, BookingStatus.REQUESTED),
        (3, 15, BookingStatus.REQUESTED),
        (4, 8, BookingStatus.REQUESTED),
    ]

    sequence = 0
    for index, (day_offset, hour, target_status) in enumerate(plan):
        route = routes[index % len(routes)]
        customer = customers[index % len(customers)]
        vehicle_type = [
            VehicleType.SEDAN,
            VehicleType.SUV,
            VehicleType.PREMIUM,
            VehicleType.SEDAN,
            VehicleType.SUV,
        ][index % 5]
        price = await mongodb.pricing().find_one(
            {"route_id": route["_id"], "vehicle_type": vehicle_type.value}
        )
        if not price:
            continue

        scheduled_at = today + dt.timedelta(days=day_offset, hours=hour)
        trip_type = (
            TripType.AIRPORT
            if "airport" in route["destination"].lower()
            else TripType.LOCAL
            if "local" in route["destination"].lower()
            else TripType.ROUND_TRIP
            if index % 5 == 0
            else TripType.ONE_WAY
        )
        breakdown = calculate_fare(
            price=price,
            route=route,
            trip_type=trip_type,
            scheduled_at=scheduled_at,
            config=config,
        )

        created_at = scheduled_at - dt.timedelta(days=RNG.randint(1, 4))
        day_key = created_at.strftime("%Y%m%d")
        sequence += 1
        reference = f"LR-{day_key}-{sequence:04d}"

        needs_driver = target_status not in {
            BookingStatus.REQUESTED,
            BookingStatus.CONFIRMED,
        }
        driver = verified_drivers[index % len(verified_drivers)] if needs_driver else None
        vehicle_id = driver["assigned_vehicle_id"] if driver else None

        is_cancelled = target_status == BookingStatus.CANCELLED
        is_completed = target_status == BookingStatus.COMPLETED

        document = {
            "booking_id": reference,
            "customer_id": customer["_id"],
            "route_id": route["_id"],
            "pickup": {
                "address": PICKUP_POINTS[index % len(PICKUP_POINTS)],
                "lat": None,
                "lng": None,
                "landmark": None,
            },
            "drop": {
                "address": DROP_POINTS[index % len(DROP_POINTS)],
                "lat": None,
                "lng": None,
                "landmark": None,
            },
            "trip_type": trip_type.value,
            "vehicle_type": vehicle_type.value,
            "vehicle_id": vehicle_id,
            "driver_id": driver["_id"] if driver else None,
            "scheduled_at": scheduled_at,
            "return_at": scheduled_at + dt.timedelta(days=1)
            if trip_type == TripType.ROUND_TRIP
            else None,
            "passenger_count": RNG.randint(1, 4),
            "passenger_name": customer["name"],
            "passenger_phone": customer["phone"],
            "notes": RNG.choice(
                [None, "Please call on arrival.", "Two large suitcases.", "Child seat needed."]
            ),
            "coupon_code": None,
            "discount": 0.0,
            "fare_breakdown": breakdown.model_dump(),
            "quoted_fare": breakdown.total,
            "total_fare": breakdown.total,
            "fare_overridden": False,
            "currency": breakdown.currency,
            "status": target_status.value,
            "payment_status": (
                PaymentStatus.PAID.value
                if is_completed
                else PaymentStatus.REFUNDED.value
                if is_cancelled and index % 2 == 0
                else PaymentStatus.CASH.value
            ),
            "payment_method": PaymentMethod.CASH.value,
            "amount_paid": breakdown.total if is_completed else 0.0,
            "cancelled_reason": "Plan changed by customer." if is_cancelled else None,
            "cancelled_by": Role.CUSTOMER.value if is_cancelled else None,
            "cancelled_at": scheduled_at - dt.timedelta(hours=6) if is_cancelled else None,
            "completed_at": scheduled_at + dt.timedelta(hours=3) if is_completed else None,
            "created_at": created_at,
            "updated_at": now(),
        }
        result = await mongodb.bookings().insert_one(document)

        # Build a plausible status history up to the target state.
        ladder = [
            (BookingStatus.REQUESTED, created_at, "Booking requested by customer."),
            (
                BookingStatus.CONFIRMED,
                created_at + dt.timedelta(minutes=25),
                "Confirmed by operations.",
            ),
            (
                BookingStatus.DRIVER_ASSIGNED,
                created_at + dt.timedelta(hours=2),
                "Driver assigned.",
            ),
            (
                BookingStatus.ACCEPTED,
                created_at + dt.timedelta(hours=2, minutes=20),
                "Driver accepted the trip.",
            ),
            (
                BookingStatus.DRIVER_ARRIVING,
                scheduled_at - dt.timedelta(minutes=30),
                "Driver heading to pickup.",
            ),
            (BookingStatus.PICKED_UP, scheduled_at, "Customer picked up."),
            (
                BookingStatus.TRIP_STARTED,
                scheduled_at + dt.timedelta(minutes=5),
                "Trip started.",
            ),
            (
                BookingStatus.COMPLETED,
                scheduled_at + dt.timedelta(hours=3),
                "Trip completed.",
            ),
        ]
        transitions = []
        for status_enum, timestamp, note in ladder:
            transitions.append((status_enum.value, timestamp, note))
            if status_enum == target_status:
                break
        if is_cancelled:
            transitions = transitions[:2] + [
                (
                    BookingStatus.CANCELLED.value,
                    scheduled_at - dt.timedelta(hours=6),
                    "Plan changed by customer.",
                )
            ]
        await _history(result.inserted_id, transitions, customer["_id"], Role.CUSTOMER.value)

        if is_completed:
            await mongodb.payments().insert_one(
                {
                    "booking_id": result.inserted_id,
                    "booking_reference": reference,
                    "customer_id": customer["_id"],
                    "amount": breakdown.total,
                    "method": PaymentMethod.CASH.value,
                    "status": PaymentStatus.PAID.value,
                    "provider": "manual",
                    "provider_reference": None,
                    "note": "Collected by driver.",
                    "recorded_by": None,
                    "created_at": document["completed_at"],
                    "updated_at": document["completed_at"],
                }
            )
            if driver:
                await mongodb.drivers().update_one(
                    {"_id": driver["_id"]}, {"$inc": {"total_trips": 1}}
                )
            # Review roughly two out of three completed trips.
            if index % 3 != 0 and driver:
                rating = RNG.choice([4, 5, 5, 5, 3])
                await mongodb.reviews().insert_one(
                    {
                        "booking_id": result.inserted_id,
                        "booking_reference": reference,
                        "customer_id": customer["_id"],
                        "driver_id": driver["_id"],
                        "rating": rating,
                        "comment": RNG.choice(
                            [
                                "Clean car and a very polite driver.",
                                "Reached well before time. Smooth trip.",
                                "Good experience overall.",
                                "Driver knew the route perfectly.",
                                "Comfortable ride, would book again.",
                            ]
                        ),
                        "is_published": True,
                        "moderation_note": None,
                        "created_at": document["completed_at"] + dt.timedelta(hours=2),
                        "updated_at": document["completed_at"] + dt.timedelta(hours=2),
                    }
                )
                existing = await mongodb.drivers().find_one({"_id": driver["_id"]})
                count = int(existing.get("rating_count", 0)) + 1
                total = float(existing.get("rating_avg", 0)) * (count - 1) + rating
                await mongodb.drivers().update_one(
                    {"_id": driver["_id"]},
                    {"$set": {"rating_avg": round(total / count, 2), "rating_count": count}},
                )

        await mongodb.notifications().insert_one(
            {
                "user_id": customer["_id"],
                "type": NotificationType.BOOKING_CREATED.value,
                "title": f"Booking {reference} received",
                "body": f"{route['name']} · ₹{breakdown.total:,.0f}",
                "booking_id": result.inserted_id,
                "data": {"booking_id": reference},
                "delivery": {"in_app": "sent"},
                "is_read": index % 2 == 0,
                "created_at": created_at,
            }
        )

        # Reflect in-progress trips on the vehicle record.
        if target_status in {BookingStatus.TRIP_STARTED, BookingStatus.PICKED_UP} and vehicle_id:
            await mongodb.vehicles().update_one(
                {"_id": vehicle_id}, {"$set": {"status": VehicleStatus.ON_TRIP.value}}
            )

        # Keep the daily counter ahead of the seeded references.
        await mongodb.counters().update_one(
            {"_id": f"booking:{day_key}"},
            {"$max": {"seq": sequence}},
            upsert=True,
        )

    print(f"  bookings: {len(plan)} created with status history")


async def main(reset: bool) -> None:
    await connect_to_mongo()
    await ensure_indexes()
    print(f"Seeding '{settings.MONGODB_DB_NAME}' …")
    if reset:
        await reset_collections()

    await seed_settings()
    await seed_admin()
    routes = await seed_routes()
    await seed_pricing(routes)
    vehicles = await seed_vehicles()
    drivers = await seed_drivers(vehicles)
    customers = await seed_customers()
    await seed_coupons()
    await seed_bookings(customers, drivers, vehicles, routes)

    print("\nDemo accounts (development only):")
    print(f"  admin    {settings.SEED_ADMIN_EMAIL} / {settings.SEED_ADMIN_PASSWORD}")
    print(f"  driver   {DRIVERS[0][1]} / {DEMO_PASSWORD}")
    print(f"  customer {CUSTOMERS[0][1]} / {DEMO_PASSWORD}")
    print("\nDone.")
    await close_mongo_connection()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Seed LocalRide demo data")
    parser.add_argument(
        "--reset", action="store_true", help="Delete existing documents before seeding"
    )
    args = parser.parse_args()
    asyncio.run(main(args.reset))
