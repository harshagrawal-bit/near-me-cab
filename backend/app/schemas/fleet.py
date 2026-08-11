"""Schemas for drivers, vehicles, routes and pricing."""

from __future__ import annotations

import datetime as dt

from pydantic import EmailStr, Field, field_validator

from app.models.enums import (
    DocumentStatus,
    DriverStatus,
    VehicleStatus,
    VehicleType,
    VerificationStatus,
)
from app.schemas.auth import MIN_PASSWORD_LENGTH
from app.schemas.common import ApiModel, Phone

# ---------------------------------------------------------------------------
# Vehicles
# ---------------------------------------------------------------------------

REGISTRATION_MAX = 16


class VehicleCreate(ApiModel):
    vehicle_type: VehicleType
    model: str = Field(min_length=2, max_length=60)
    registration_number: str = Field(min_length=4, max_length=REGISTRATION_MAX)
    seating_capacity: int = Field(ge=1, le=30)
    is_ac: bool = True
    status: VehicleStatus = VehicleStatus.AVAILABLE
    notes: str | None = Field(default=None, max_length=300)

    @field_validator("registration_number")
    @classmethod
    def normalise_registration(cls, value: str) -> str:
        return value.upper().replace(" ", "").replace("-", "")


class VehicleUpdate(ApiModel):
    vehicle_type: VehicleType | None = None
    model: str | None = Field(default=None, min_length=2, max_length=60)
    registration_number: str | None = Field(default=None, min_length=4, max_length=REGISTRATION_MAX)
    seating_capacity: int | None = Field(default=None, ge=1, le=30)
    is_ac: bool | None = None
    status: VehicleStatus | None = None
    notes: str | None = Field(default=None, max_length=300)

    @field_validator("registration_number")
    @classmethod
    def normalise_registration(cls, value: str | None) -> str | None:
        return value.upper().replace(" ", "").replace("-", "") if value else value


# ---------------------------------------------------------------------------
# Drivers
# ---------------------------------------------------------------------------


class DriverDocument(ApiModel):
    type: str = Field(min_length=2, max_length=40)
    number: str | None = Field(default=None, max_length=40)
    status: DocumentStatus = DocumentStatus.PENDING
    expires_on: dt.date | None = None
    file_url: str | None = Field(default=None, max_length=500)


class DriverCreate(ApiModel):
    name: str = Field(min_length=2, max_length=80)
    email: EmailStr
    phone: Phone
    password: str = Field(min_length=MIN_PASSWORD_LENGTH, max_length=72)
    licence_number: str = Field(min_length=4, max_length=32)
    licence_expiry: dt.date
    avatar_url: str | None = Field(default=None, max_length=500)
    assigned_vehicle_id: str | None = None
    documents: list[DriverDocument] = Field(default_factory=list, max_length=12)

    @field_validator("email")
    @classmethod
    def lower_email(cls, value: str) -> str:
        return value.lower()

    @field_validator("licence_number")
    @classmethod
    def upper_licence(cls, value: str) -> str:
        return value.upper().replace(" ", "")


class DriverUpdate(ApiModel):
    name: str | None = Field(default=None, min_length=2, max_length=80)
    phone: Phone | None = None
    email: EmailStr | None = None
    avatar_url: str | None = Field(default=None, max_length=500)
    licence_number: str | None = Field(default=None, min_length=4, max_length=32)
    licence_expiry: dt.date | None = None
    verification_status: VerificationStatus | None = None
    status: DriverStatus | None = None
    assigned_vehicle_id: str | None = None
    documents: list[DriverDocument] | None = Field(default=None, max_length=12)

    @field_validator("email")
    @classmethod
    def lower_email(cls, value: str | None) -> str | None:
        return value.lower() if value else value


class DriverSelfUpdate(ApiModel):
    """Fields a driver may change on their own record."""

    name: str | None = Field(default=None, min_length=2, max_length=80)
    phone: Phone | None = None
    avatar_url: str | None = Field(default=None, max_length=500)


class AvailabilityUpdate(ApiModel):
    is_available: bool


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------


class RouteCreate(ApiModel):
    origin: str = Field(min_length=2, max_length=60)
    destination: str = Field(min_length=2, max_length=60)
    name: str | None = Field(default=None, max_length=100)
    distance_km: float = Field(gt=0, le=5000)
    duration_minutes: int = Field(gt=0, le=10_000)
    is_active: bool = True


class RouteUpdate(ApiModel):
    origin: str | None = Field(default=None, min_length=2, max_length=60)
    destination: str | None = Field(default=None, min_length=2, max_length=60)
    name: str | None = Field(default=None, max_length=100)
    distance_km: float | None = Field(default=None, gt=0, le=5000)
    duration_minutes: int | None = Field(default=None, gt=0, le=10_000)
    is_active: bool | None = None


# ---------------------------------------------------------------------------
# Pricing
# ---------------------------------------------------------------------------


class PricingUpsert(ApiModel):
    """A price row for one route + vehicle type.

    `fixed_fare` drives the MVP route-based model. When it is omitted the
    engine falls back to `base_fare + per_km_rate * distance`, which is the
    hook for distance-based dynamic pricing later.
    """

    route_id: str
    vehicle_type: VehicleType
    fixed_fare: float | None = Field(default=None, ge=0, le=1_000_000)
    base_fare: float = Field(default=0, ge=0, le=1_000_000)
    per_km_rate: float = Field(default=0, ge=0, le=1000)
    driver_allowance: float = Field(default=0, ge=0, le=100_000)
    toll: float = Field(default=0, ge=0, le=100_000)
    night_surcharge: float = Field(default=0, ge=0, le=100_000)
    airport_surcharge: float = Field(default=0, ge=0, le=100_000)
    additional_charges: float = Field(default=0, ge=0, le=100_000)
    is_active: bool = True


class PricingUpdate(ApiModel):
    fixed_fare: float | None = Field(default=None, ge=0, le=1_000_000)
    base_fare: float | None = Field(default=None, ge=0, le=1_000_000)
    per_km_rate: float | None = Field(default=None, ge=0, le=1000)
    driver_allowance: float | None = Field(default=None, ge=0, le=100_000)
    toll: float | None = Field(default=None, ge=0, le=100_000)
    night_surcharge: float | None = Field(default=None, ge=0, le=100_000)
    airport_surcharge: float | None = Field(default=None, ge=0, le=100_000)
    additional_charges: float | None = Field(default=None, ge=0, le=100_000)
    is_active: bool | None = None
