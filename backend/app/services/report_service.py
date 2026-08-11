"""Admin dashboard metrics and date-filtered reports.

Revenue counts completed trips only — a requested or cancelled booking is not
money in the bank.
"""

from __future__ import annotations

import datetime as dt
from typing import Any

from app.core.timezone import local_date, start_of_local_day
from app.db import mongodb
from app.models.enums import (
    ACTIVE_BOOKING_STATUSES,
    BOOKING_STATUS_LABELS,
    BookingStatus,
    DriverStatus,
    PaymentStatus,
    Role,
    VerificationStatus,
)
from app.schemas.common import ensure_aware, serialize, utcnow
from app.services import booking_service


def _day_bounds(when: dt.datetime | None = None) -> tuple[dt.datetime, dt.datetime]:
    """Start and end of the current *business* day, expressed in UTC."""
    start = start_of_local_day(when or utcnow())
    return start, start + dt.timedelta(days=1)


async def _sum_revenue(match: dict[str, Any]) -> float:
    pipeline = [{"$match": match}, {"$group": {"_id": None, "total": {"$sum": "$total_fare"}}}]
    async for doc in mongodb.bookings().aggregate(pipeline):
        return round(float(doc["total"]), 2)
    return 0.0


async def dashboard_summary() -> dict[str, Any]:
    bookings = mongodb.bookings()
    start_of_day, end_of_day = _day_bounds()
    now = utcnow()

    today_query = {"created_at": {"$gte": start_of_day, "$lt": end_of_day}}
    status_counts_pipeline = [{"$group": {"_id": "$status", "count": {"$sum": 1}}}]
    status_counts = {
        doc["_id"]: doc["count"] async for doc in bookings.aggregate(status_counts_pipeline)
    }

    todays_revenue = await _sum_revenue(
        {
            "status": BookingStatus.COMPLETED.value,
            "completed_at": {"$gte": start_of_day, "$lt": end_of_day},
        }
    )
    month_start = start_of_local_day(utcnow().replace(day=1))
    month_revenue = await _sum_revenue(
        {"status": BookingStatus.COMPLETED.value, "completed_at": {"$gte": month_start}}
    )

    active_drivers = await mongodb.drivers().count_documents(
        {"status": DriverStatus.ACTIVE.value, "verification_status": VerificationStatus.VERIFIED.value}
    )
    available_drivers = await mongodb.drivers().count_documents(
        {
            "status": DriverStatus.ACTIVE.value,
            "verification_status": VerificationStatus.VERIFIED.value,
            "is_available": True,
        }
    )
    on_trip_drivers = len(
        await bookings.distinct(
            "driver_id", {"status": {"$in": list(ACTIVE_BOOKING_STATUSES)}, "driver_id": {"$ne": None}}
        )
    )

    cards = {
        "todays_bookings": await bookings.count_documents(today_query),
        "pending_bookings": status_counts.get(BookingStatus.REQUESTED.value, 0),
        "confirmed_bookings": status_counts.get(BookingStatus.CONFIRMED.value, 0),
        "active_bookings": sum(status_counts.get(s.value, 0) for s in ACTIVE_BOOKING_STATUSES),
        "completed_bookings": status_counts.get(BookingStatus.COMPLETED.value, 0),
        "cancelled_bookings": status_counts.get(BookingStatus.CANCELLED.value, 0),
        "todays_revenue": todays_revenue,
        "month_revenue": month_revenue,
        "active_drivers": active_drivers,
        "available_drivers": available_drivers,
        "on_trip_drivers": on_trip_drivers,
        "total_customers": await mongodb.users().count_documents({"role": Role.CUSTOMER.value}),
        "unpaid_bookings": await bookings.count_documents(
            {
                "payment_status": {
                    "$in": [PaymentStatus.PENDING.value, PaymentStatus.PARTIALLY_PAID.value]
                },
                "status": BookingStatus.COMPLETED.value,
            }
        ),
    }

    recent = [
        await booking_service.hydrate(doc)
        async for doc in bookings.find().sort("created_at", -1).limit(6)
    ]
    upcoming = [
        await booking_service.hydrate(doc)
        async for doc in bookings.find(
            {
                "scheduled_at": {"$gte": now},
                "status": {
                    "$nin": [BookingStatus.CANCELLED.value, BookingStatus.COMPLETED.value]
                },
            }
        )
        .sort("scheduled_at", 1)
        .limit(6)
    ]

    distribution = [
        {
            "status": status,
            "label": BOOKING_STATUS_LABELS.get(status, status),
            "count": count,
        }
        for status, count in sorted(status_counts.items(), key=lambda kv: -kv[1])
    ]

    revenue_trend = []
    for offset in range(13, -1, -1):
        day_start = start_of_day - dt.timedelta(days=offset)
        day_end = day_start + dt.timedelta(days=1)
        revenue_trend.append(
            {
                "date": local_date(day_start).isoformat(),
                "revenue": await _sum_revenue(
                    {
                        "status": BookingStatus.COMPLETED.value,
                        "completed_at": {"$gte": day_start, "$lt": day_end},
                    }
                ),
                "bookings": await bookings.count_documents(
                    {"created_at": {"$gte": day_start, "$lt": day_end}}
                ),
            }
        )

    return {
        "cards": cards,
        "recent_bookings": recent,
        "upcoming_trips": upcoming,
        "status_distribution": distribution,
        "revenue_trend": revenue_trend,
        "generated_at": serialize(now),
    }


async def reports(
    date_from: dt.datetime | None, date_to: dt.datetime | None
) -> dict[str, Any]:
    start = ensure_aware(date_from) or (utcnow() - dt.timedelta(days=30))
    end = ensure_aware(date_to) or utcnow()
    window = {"created_at": {"$gte": start, "$lte": end}}
    completed_window = {
        "status": BookingStatus.COMPLETED.value,
        "completed_at": {"$gte": start, "$lte": end},
    }
    bookings = mongodb.bookings()

    total_bookings = await bookings.count_documents(window)
    completed = await bookings.count_documents(completed_window)
    cancelled = await bookings.count_documents({**window, "status": BookingStatus.CANCELLED.value})
    revenue = await _sum_revenue(completed_window)

    # ---- Driver performance
    driver_pipeline = [
        {"$match": completed_window},
        {
            "$group": {
                "_id": "$driver_id",
                "trips": {"$sum": 1},
                "revenue": {"$sum": "$total_fare"},
            }
        },
        {"$sort": {"revenue": -1}},
        {"$limit": 15},
    ]
    driver_rows = []
    async for doc in bookings.aggregate(driver_pipeline):
        if not doc["_id"]:
            continue
        driver = await mongodb.drivers().find_one({"_id": doc["_id"]})
        name, rating = "Unknown driver", 0
        if driver:
            user = await mongodb.users().find_one({"_id": driver["user_id"]}, {"name": 1})
            name = user["name"] if user else name
            rating = driver.get("rating_avg", 0)
        cancelled_for_driver = await bookings.count_documents(
            {**window, "driver_id": doc["_id"], "status": BookingStatus.CANCELLED.value}
        )
        driver_rows.append(
            {
                "driver_id": str(doc["_id"]),
                "name": name,
                "trips": doc["trips"],
                "revenue": round(doc["revenue"], 2),
                "rating": rating,
                "cancelled": cancelled_for_driver,
            }
        )

    # ---- Route performance
    route_pipeline = [
        {"$match": window},
        {
            "$group": {
                "_id": "$route_id",
                "bookings": {"$sum": 1},
                "revenue": {
                    "$sum": {
                        "$cond": [
                            {"$eq": ["$status", BookingStatus.COMPLETED.value]},
                            "$total_fare",
                            0,
                        ]
                    }
                },
                "completed": {
                    "$sum": {
                        "$cond": [{"$eq": ["$status", BookingStatus.COMPLETED.value]}, 1, 0]
                    }
                },
            }
        },
        {"$sort": {"bookings": -1}},
        {"$limit": 15},
    ]
    route_rows = []
    async for doc in bookings.aggregate(route_pipeline):
        route = await mongodb.routes().find_one({"_id": doc["_id"]}) if doc["_id"] else None
        route_rows.append(
            {
                "route_id": str(doc["_id"]) if doc["_id"] else None,
                "name": route["name"] if route else "Custom trip",
                "bookings": doc["bookings"],
                "completed": doc["completed"],
                "revenue": round(doc["revenue"], 2),
            }
        )

    # ---- Vehicle class mix
    vehicle_pipeline = [
        {"$match": window},
        {
            "$group": {
                "_id": "$vehicle_type",
                "bookings": {"$sum": 1},
                "revenue": {
                    "$sum": {
                        "$cond": [
                            {"$eq": ["$status", BookingStatus.COMPLETED.value]},
                            "$total_fare",
                            0,
                        ]
                    }
                },
            }
        },
        {"$sort": {"bookings": -1}},
    ]
    vehicle_rows = [
        {
            "vehicle_type": doc["_id"],
            "bookings": doc["bookings"],
            "revenue": round(doc["revenue"], 2),
        }
        async for doc in bookings.aggregate(vehicle_pipeline)
    ]

    # ---- Daily series
    daily = []
    cursor_day = start_of_local_day(start)
    guard = 0
    while cursor_day <= end and guard < 400:
        next_day = cursor_day + dt.timedelta(days=1)
        daily.append(
            {
                "date": local_date(cursor_day).isoformat(),
                "bookings": await bookings.count_documents(
                    {"created_at": {"$gte": cursor_day, "$lt": next_day}}
                ),
                "revenue": await _sum_revenue(
                    {
                        "status": BookingStatus.COMPLETED.value,
                        "completed_at": {"$gte": cursor_day, "$lt": next_day},
                    }
                ),
            }
        )
        cursor_day = next_day
        guard += 1

    payment_pipeline = [
        {"$match": window},
        {"$group": {"_id": "$payment_status", "count": {"$sum": 1}, "amount": {"$sum": "$total_fare"}}},
    ]
    payment_rows = [
        {"status": doc["_id"], "count": doc["count"], "amount": round(doc["amount"], 2)}
        async for doc in bookings.aggregate(payment_pipeline)
    ]

    return {
        "range": {"from": serialize(start), "to": serialize(end)},
        "summary": {
            "total_bookings": total_bookings,
            "completed_trips": completed,
            "cancelled_trips": cancelled,
            "revenue": revenue,
            "average_fare": round(revenue / completed, 2) if completed else 0.0,
            "completion_rate": round(completed / total_bookings * 100, 1) if total_bookings else 0.0,
        },
        "daily": daily,
        "drivers": driver_rows,
        "routes": route_rows,
        "vehicles": vehicle_rows,
        "payments": payment_rows,
    }
