"""Fleet-owner schemas: self-signup, sub-drivers, owned vehicles, wallet.

A "driver" in this system is one of two things. An **owner** signs themselves
up, keeps a security deposit, owns vehicles and may employ others. An
**employed** driver is created by an owner, has their own login, holds no
deposit, and only ever sees trips assigned to them.
"""

from __future__ import annotations

import datetime as dt

from pydantic import EmailStr, Field, field_validator

from app.models.enums import VehicleType
from app.schemas.auth import MIN_PASSWORD_LENGTH
from app.schemas.common import ApiModel, Phone, ResponseModel

LICENCE_MAX = 32
REGISTRATION_MAX = 16


def _upper_no_space(value: str) -> str:
    return value.upper().replace(" ", "").replace("-", "")


# ---------------------------------------------------------------------------
# Signup
# ---------------------------------------------------------------------------


class DriverSignup(ApiModel):
    """Public "sign up as a driver" payload.

    Deliberately cannot set `driver_type`, `owner_id`, wallet balance or
    verification status — `extra="forbid"` on ApiModel means a client cannot
    smuggle them in, and the service always creates an unverified OWNER with a
    zero balance.
    """

    name: str = Field(min_length=2, max_length=80)
    email: EmailStr
    phone: Phone
    password: str = Field(min_length=MIN_PASSWORD_LENGTH, max_length=72)
    licence_number: str = Field(min_length=4, max_length=LICENCE_MAX)
    licence_expiry: dt.date

    @field_validator("email")
    @classmethod
    def lower_email(cls, value: str) -> str:
        return value.lower()

    @field_validator("licence_number")
    @classmethod
    def upper_licence(cls, value: str) -> str:
        return _upper_no_space(value)

    @field_validator("licence_expiry")
    @classmethod
    def not_already_expired(cls, value: dt.date) -> dt.date:
        if value <= dt.date.today():
            raise ValueError("Licence has already expired.")
        return value


class SubDriverCreate(ApiModel):
    """A driver employed by an owner. Gets their own login."""

    name: str = Field(min_length=2, max_length=80)
    email: EmailStr
    phone: Phone
    password: str = Field(min_length=MIN_PASSWORD_LENGTH, max_length=72)
    licence_number: str = Field(min_length=4, max_length=LICENCE_MAX)
    licence_expiry: dt.date

    @field_validator("email")
    @classmethod
    def lower_email(cls, value: str) -> str:
        return value.lower()

    @field_validator("licence_number")
    @classmethod
    def upper_licence(cls, value: str) -> str:
        return _upper_no_space(value)


# ---------------------------------------------------------------------------
# Vehicles owned by a fleet owner
# ---------------------------------------------------------------------------


class OwnerVehicleCreate(ApiModel):
    vehicle_type: VehicleType
    model: str = Field(min_length=2, max_length=60)
    registration_number: str = Field(min_length=4, max_length=REGISTRATION_MAX)
    seating_capacity: int = Field(default=4, ge=1, le=30)
    is_ac: bool = True

    @field_validator("registration_number")
    @classmethod
    def normalise(cls, value: str) -> str:
        return _upper_no_space(value)


# ---------------------------------------------------------------------------
# Documents
# ---------------------------------------------------------------------------


class DocumentUpload(ApiModel):
    """Attach a document to a driver record.

    `file_url` points at wherever the file actually lives — object storage in
    production. Nothing here stores the bytes themselves; putting scans in the
    database is how a 512 MB cluster dies.
    """

    type: str = Field(min_length=2, max_length=40)
    number: str | None = Field(default=None, max_length=40)
    file_url: str | None = Field(default=None, max_length=500)
    expires_on: dt.date | None = None


# ---------------------------------------------------------------------------
# Wallet
# ---------------------------------------------------------------------------


class WalletTopUp(ApiModel):
    """Adding to the security deposit.

    There is no payment gateway behind this yet, so the route that accepts it
    is admin-only: operations record a transfer they have actually received.
    A driver cannot credit their own wallet by calling the API.
    """

    amount: float = Field(gt=0, le=1_000_000)
    note: str | None = Field(default=None, max_length=200)
    reference: str | None = Field(default=None, max_length=80)


class WalletAdjustment(ApiModel):
    amount: float = Field(le=1_000_000)
    note: str = Field(min_length=3, max_length=200)


class WalletSummary(ResponseModel):
    balance: float
    held: float
    available: float
    min_balance: float
    eligible: bool
    reason: str = ""
    #: The owner's own driver record, so the app can offer "Myself" when
    #: choosing who drives a trip.
    driver_id: str | None = None
    driver_type: str | None = None


# ---------------------------------------------------------------------------
# Accepting work
# ---------------------------------------------------------------------------


class BookingAcceptance(ApiModel):
    """An owner taking a trip: which car, and which of their drivers.

    `driver_id` may be the owner's own driver record — a one-person operation
    drives their own trips.
    """

    vehicle_id: str = Field(min_length=24, max_length=24)
    driver_id: str = Field(min_length=24, max_length=24)
