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


class BankDetails(ApiModel):
    """Where a driver's withdrawals and payouts are actually sent.

    Razorpay can only refund money back down the path it arrived on, so it
    cannot be used to pay a driver who never paid us. Payouts are therefore a
    bank transfer the office makes, and these are the details it needs.

    Stored as given. The account number is masked on the way out, so support
    staff can confirm the last four digits without the whole number being
    readable on every screen.
    """

    account_name: str = Field(min_length=2, max_length=120)
    account_number: str = Field(min_length=6, max_length=24, pattern=r"^[0-9]+$")
    ifsc: str = Field(min_length=11, max_length=11, pattern=r"^[A-Za-z]{4}0[A-Za-z0-9]{6}$")
    bank_name: str | None = Field(default=None, max_length=120)
    upi_id: str | None = Field(default=None, max_length=120)


class DriverPayout(ApiModel):
    """An admin paying a driver their share of a trip.

    The amount is the admin's decision, not a computed split: what a driver is
    owed on a given trip is a commercial call that varies by route, vehicle and
    agreement, and pretending otherwise would bake one deal into the code.
    """

    amount: float = Field(gt=0, le=1_000_000)
    booking_id: str | None = Field(default=None, max_length=40)
    note: str | None = Field(default=None, max_length=300)


class PenaltyCharge(ApiModel):
    """A manual penalty or a reversal of one."""

    amount: float = Field(gt=0, le=100_000)
    reason: str = Field(min_length=3, max_length=300)
    booking_id: str | None = Field(default=None, max_length=40)
