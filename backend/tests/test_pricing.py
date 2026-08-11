"""Fare engine tests — the part of the system that decides what people pay."""

from __future__ import annotations

import datetime as dt

import pytest

from app.models.enums import TripType
from app.schemas.admin import PricingSettings
from app.services.pricing_service import _is_night, calculate_fare

ROUTE = {"distance_km": 150.0}
FIXED_PRICE = {"fixed_fare": 3000.0, "night_surcharge": 250.0}


def test_fixed_route_fare_is_used_verbatim():
    fare = calculate_fare(
        price=FIXED_PRICE,
        route=ROUTE,
        trip_type=TripType.ONE_WAY,
        scheduled_at=None,
        config=PricingSettings(),
    )
    assert fare.total == 3000
    assert fare.base_fare == 3000
    assert fare.distance_charge == 0


def test_distance_strategy_used_when_no_fixed_fare():
    fare = calculate_fare(
        price={"base_fare": 500.0, "per_km_rate": 12.0},
        route=ROUTE,
        trip_type=TripType.ONE_WAY,
        scheduled_at=None,
        config=PricingSettings(),
    )
    # 500 + 12 * 150
    assert fare.total == 2300


def test_round_trip_multiplier_applies_to_travel_only():
    config = PricingSettings(round_trip_multiplier=2.0)
    fare = calculate_fare(
        price={"fixed_fare": 3000.0, "driver_allowance": 400.0},
        route=ROUTE,
        trip_type=TripType.ROUND_TRIP,
        scheduled_at=None,
        config=config,
    )
    # Travel doubles; the allowance is a trip-level amount and does not.
    assert fare.total == 6400


def test_discount_never_exceeds_subtotal():
    fare = calculate_fare(
        price=FIXED_PRICE,
        route=ROUTE,
        trip_type=TripType.ONE_WAY,
        scheduled_at=None,
        config=PricingSettings(),
        discount=99_999.0,
    )
    assert fare.discount == 3000
    assert fare.total == 0


def test_tax_applies_after_discount():
    config = PricingSettings(tax_percent=10)
    fare = calculate_fare(
        price=FIXED_PRICE,
        route=ROUTE,
        trip_type=TripType.ONE_WAY,
        scheduled_at=None,
        config=config,
        discount=1000.0,
    )
    # (3000 - 1000) * 1.10
    assert fare.total == 2200


@pytest.mark.parametrize(
    "utc_hour,expected_night",
    [
        (3, False),   # 08:30 IST — morning
        (6, False),   # 11:30 IST — midday
        (12, False),  # 17:30 IST — evening
        (17, True),   # 22:30 IST — night
        (20, True),   # 01:30 IST — night
        (22, True),   # 03:30 IST — night
        (1, False),   # 06:30 IST — early morning, window has closed
    ],
)
def test_night_window_follows_business_timezone(utc_hour, expected_night):
    """The night window is local wall-clock, not UTC.

    Regression guard: evaluating in UTC billed a 09:00 IST pickup as a night
    trip, because that instant is 03:30 UTC.
    """
    when = dt.datetime(2026, 8, 2, utc_hour, 30, tzinfo=dt.timezone.utc)
    assert _is_night(when, PricingSettings()) is expected_night


def test_night_surcharge_added_only_at_night():
    day = calculate_fare(
        price=FIXED_PRICE,
        route=ROUTE,
        trip_type=TripType.ONE_WAY,
        scheduled_at=dt.datetime(2026, 8, 2, 3, 30, tzinfo=dt.timezone.utc),  # 09:00 IST
        config=PricingSettings(),
    )
    night = calculate_fare(
        price=FIXED_PRICE,
        route=ROUTE,
        trip_type=TripType.ONE_WAY,
        scheduled_at=dt.datetime(2026, 8, 2, 17, 30, tzinfo=dt.timezone.utc),  # 23:00 IST
        config=PricingSettings(),
    )
    assert day.night_surcharge == 0
    assert day.total == 3000
    assert night.night_surcharge == 250
    assert night.total == 3250


def test_airport_surcharge_only_on_airport_trips():
    price = {"fixed_fare": 700.0, "airport_surcharge": 150.0}
    one_way = calculate_fare(
        price=price,
        route=ROUTE,
        trip_type=TripType.ONE_WAY,
        scheduled_at=None,
        config=PricingSettings(),
    )
    airport = calculate_fare(
        price=price,
        route=ROUTE,
        trip_type=TripType.AIRPORT,
        scheduled_at=None,
        config=PricingSettings(),
    )
    assert one_way.airport_surcharge == 0
    assert airport.airport_surcharge == 150
    assert airport.total == one_way.total + 150
