"""Booking, quote, payment, coupon and review schemas."""

from __future__ import annotations

import datetime as dt

from pydantic import Field, field_validator, model_validator

from app.models.enums import (
    BookingStatus,
    DiscountType,
    PaymentMethod,
    PaymentStatus,
    TripType,
    VehicleType,
)
from app.schemas.common import ApiModel, Phone, ResponseModel


class LocationInput(ApiModel):
    address: str = Field(min_length=3, max_length=200)
    lat: float | None = Field(default=None, ge=-90, le=90)
    lng: float | None = Field(default=None, ge=-180, le=180)
    landmark: str | None = Field(default=None, max_length=120)


# ---------------------------------------------------------------------------
# Fare quotes
# ---------------------------------------------------------------------------


class QuoteRequest(ApiModel):
    """Ask the backend what a trip costs.

    Either `route_id` or a pickup/drop pair is required; the pair is resolved
    to a route server-side. The client never supplies a price.
    """

    route_id: str | None = None
    pickup: str | None = Field(default=None, max_length=200)
    drop: str | None = Field(default=None, max_length=200)
    trip_type: TripType = TripType.ONE_WAY
    vehicle_type: VehicleType | None = None
    scheduled_at: dt.datetime | None = None
    coupon_code: str | None = Field(default=None, max_length=24)

    @model_validator(mode="after")
    def require_route_or_places(self) -> "QuoteRequest":
        if not self.route_id and not (self.pickup and self.drop):
            raise ValueError("Provide a route, or both a pickup and drop location.")
        return self


class FareBreakdown(ResponseModel):
    base_fare: float
    distance_charge: float
    driver_allowance: float
    toll: float
    night_surcharge: float
    airport_surcharge: float
    additional_charges: float
    trip_type_multiplier: float
    subtotal: float
    discount: float
    tax: float
    total: float
    currency: str = "INR"


class VehicleQuote(ResponseModel):
    vehicle_type: VehicleType
    label: str
    seating_capacity: int
    description: str | None = None
    available_vehicles: int
    fare: float
    breakdown: FareBreakdown


class QuoteResponse(ResponseModel):
    route: dict
    trip_type: TripType
    scheduled_at: str | None = None
    coupon: dict | None = None
    options: list[VehicleQuote]


# ---------------------------------------------------------------------------
# Bookings
# ---------------------------------------------------------------------------


class BookingCreate(ApiModel):
    route_id: str | None = None
    pickup: LocationInput
    drop: LocationInput
    trip_type: TripType = TripType.ONE_WAY
    vehicle_type: VehicleType
    scheduled_at: dt.datetime
    return_at: dt.datetime | None = None
    passenger_count: int = Field(default=1, ge=1, le=30)
    passenger_name: str = Field(min_length=2, max_length=80)
    passenger_phone: Phone
    notes: str | None = Field(default=None, max_length=500)
    coupon_code: str | None = Field(default=None, max_length=24)
    payment_method: PaymentMethod = PaymentMethod.CASH
    #: pay_later | part | full. Chooses how much is asked for up front; the
    #: server still derives the actual figure, so this names an option, never
    #: an amount.
    payment_option: str = Field(default="part", max_length=12)

    @field_validator("coupon_code")
    @classmethod
    def upper_coupon(cls, value: str | None) -> str | None:
        return value.upper().strip() if value else None

    @model_validator(mode="after")
    def check_return(self) -> "BookingCreate":
        if self.trip_type == TripType.ROUND_TRIP and self.return_at:
            if self.return_at <= self.scheduled_at:
                raise ValueError("Return date must be after the pickup date.")
        return self


class BookingCancel(ApiModel):
    reason: str = Field(min_length=3, max_length=300)


class BookingStatusUpdate(ApiModel):
    status: BookingStatus
    note: str | None = Field(default=None, max_length=300)


class AssignDriverRequest(ApiModel):
    driver_id: str
    vehicle_id: str | None = None
    note: str | None = Field(default=None, max_length=300)


class FareOverrideRequest(ApiModel):
    total_fare: float = Field(ge=0, le=1_000_000)
    reason: str = Field(min_length=3, max_length=300)


class BookingFilters(ApiModel):
    status: BookingStatus | None = None
    payment_status: PaymentStatus | None = None
    driver_id: str | None = None
    vehicle_id: str | None = None
    route_id: str | None = None
    customer_id: str | None = None
    trip_type: TripType | None = None
    date_from: dt.datetime | None = None
    date_to: dt.datetime | None = None
    search: str | None = Field(default=None, max_length=80)


# ---------------------------------------------------------------------------
# Payments
# ---------------------------------------------------------------------------


class PaymentRecord(ApiModel):
    amount: float = Field(gt=0, le=1_000_000)
    method: PaymentMethod = PaymentMethod.CASH
    status: PaymentStatus = PaymentStatus.PAID
    reference: str | None = Field(default=None, max_length=80)
    note: str | None = Field(default=None, max_length=300)


class PaymentStatusUpdate(ApiModel):
    payment_status: PaymentStatus
    note: str | None = Field(default=None, max_length=300)


# ---------------------------------------------------------------------------
# Coupons
# ---------------------------------------------------------------------------


class CouponCreate(ApiModel):
    code: str = Field(min_length=3, max_length=24, pattern=r"^[A-Za-z0-9_-]+$")
    description: str | None = Field(default=None, max_length=160)
    discount_type: DiscountType = DiscountType.PERCENT
    discount_value: float = Field(gt=0, le=100_000)
    min_booking_value: float = Field(default=0, ge=0, le=1_000_000)
    max_discount: float | None = Field(default=None, ge=0, le=1_000_000)
    expires_at: dt.datetime | None = None
    usage_limit: int | None = Field(default=None, ge=1, le=1_000_000)
    is_active: bool = True

    @field_validator("code")
    @classmethod
    def upper_code(cls, value: str) -> str:
        return value.upper()

    @model_validator(mode="after")
    def check_percent(self) -> "CouponCreate":
        if self.discount_type == DiscountType.PERCENT and self.discount_value > 100:
            raise ValueError("A percentage discount cannot exceed 100.")
        return self


class CouponUpdate(ApiModel):
    description: str | None = Field(default=None, max_length=160)
    discount_type: DiscountType | None = None
    discount_value: float | None = Field(default=None, gt=0, le=100_000)
    min_booking_value: float | None = Field(default=None, ge=0, le=1_000_000)
    max_discount: float | None = Field(default=None, ge=0, le=1_000_000)
    expires_at: dt.datetime | None = None
    usage_limit: int | None = Field(default=None, ge=1, le=1_000_000)
    is_active: bool | None = None


# ---------------------------------------------------------------------------
# Reviews
# ---------------------------------------------------------------------------


class ReviewCreate(ApiModel):
    booking_id: str
    rating: int = Field(ge=1, le=5)
    comment: str | None = Field(default=None, max_length=1000)


class ReviewModerate(ApiModel):
    is_published: bool
    moderation_note: str | None = Field(default=None, max_length=300)
