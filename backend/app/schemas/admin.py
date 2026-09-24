"""Admin settings and support schemas."""

from __future__ import annotations

from pydantic import EmailStr, Field, model_validator

from app.schemas.common import ApiModel, Phone


class CompanySettings(ApiModel):
    legal_name: str = Field(default="LocalRide Travels", max_length=120)
    support_email: str = Field(default="support@localride.in", max_length=120)
    support_phone: str = Field(default="9000000000", max_length=20)
    whatsapp_number: str = Field(default="9000000000", max_length=20)
    address: str = Field(default="Pune, Maharashtra", max_length=250)
    gst_number: str | None = Field(default=None, max_length=20)
    working_hours: str = Field(default="24x7", max_length=60)


class PricingSettings(ApiModel):
    """Knobs the fare engine reads. Editable by admin, never by the client."""

    currency: str = Field(default="INR", max_length=3)
    #: Night-window hours below are wall-clock hours in this zone, not UTC.
    timezone: str = Field(default="Asia/Kolkata", max_length=64)
    round_trip_multiplier: float = Field(default=1.85, ge=1, le=5)
    local_multiplier: float = Field(default=1.0, ge=0.1, le=5)
    airport_multiplier: float = Field(default=1.0, ge=0.1, le=5)
    one_way_multiplier: float = Field(default=1.0, ge=0.1, le=5)
    night_start_hour: int = Field(default=22, ge=0, le=23)
    night_end_hour: int = Field(default=5, ge=0, le=23)
    tax_percent: float = Field(default=0, ge=0, le=50)
    free_cancellation_hours: int = Field(default=2, ge=0, le=168)
    cancellation_fee_percent: float = Field(default=0, ge=0, le=100)


class BookingSettings(ApiModel):
    min_advance_minutes: int = Field(default=30, ge=0, le=10_080)
    max_advance_days: int = Field(default=90, ge=1, le=365)
    auto_confirm: bool = False


class AdvanceSettings(ApiModel):
    """The deposit a customer pays to turn a confirmed quote into a booking.

    The percentage lives here rather than in the frontend so it can be changed
    without a release, and so the server remains the only thing that decides
    what a customer owes.
    """

    enabled: bool = True
    percent: float = Field(default=15, ge=0, le=100)
    #: Never ask for less than this, so tiny trips still carry a real commitment.
    min_amount: float = Field(default=0, ge=0, le=100_000)
    #: 0 disables the ceiling. Stops a long outstation trip demanding a fortune up front.
    max_amount: float = Field(default=0, ge=0, le=100_000)

    @model_validator(mode="after")
    def _floor_below_ceiling(self) -> "AdvanceSettings":
        # Without this an inverted pair is accepted and then silently resolved
        # in favour of the ceiling, so the floor an admin typed does nothing.
        if self.max_amount and self.min_amount > self.max_amount:
            raise ValueError("Minimum advance cannot be more than the maximum.")
        return self


class WalletSettings(ApiModel):
    """Security deposit rules for fleet owners.

    `min_balance` is the floor an owner must keep to stay eligible for work at
    all. `per_ride_*` describe the additional amount a specific ride ties up
    while it is live — the real formula is pending, so this is deliberately a
    simple, documented placeholder that `wallet_service.required_for_booking`
    reads. Changing the rule should mean changing that one function.
    """

    #: Capped as well as floored: with no ceiling a mistyped 1000000 makes
    #: every fleet owner ineligible at once, with no way back except the
    #: database, because the block is exactly what stops them using the app.
    min_balance: float = Field(default=800, ge=0, le=100_000)
    #: Share of the trip fare that must be available to accept it.
    per_ride_percent: float = Field(default=10, ge=0, le=100)
    #: Floor for the per-ride requirement.
    per_ride_min: float = Field(default=200, ge=0, le=100_000)
    #: 0 disables the ceiling.
    per_ride_max: float = Field(default=0, ge=0, le=100_000)

    @model_validator(mode="after")
    def _floor_below_ceiling(self) -> "WalletSettings":
        if self.per_ride_max and self.per_ride_min > self.per_ride_max:
            raise ValueError("Per-ride minimum cannot be more than the maximum.")
        return self


class CancellationSettings(ApiModel):
    """What a cancellation costs, on both sides.

    Customer and driver are deliberately separate rules. A customer who changes
    their mind loses part of an advance they already paid; a driver who drops a
    trip they accepted costs the business a booking, so the charge comes out of
    the security deposit instead.
    """

    #: Share of a paid advance kept when a customer cancels inside the free
    #: window. The rest is refunded.
    customer_fee_percent: float = Field(default=50, ge=0, le=100)
    #: Hours before pickup inside which the fee applies. Cancel earlier and the
    #: whole advance comes back.
    customer_free_hours: int = Field(default=2, ge=0, le=168)

    #: Driver penalties, charged to the wallet. Flat within the grace window
    #: after accepting, then rising as pickup approaches — a late drop is the
    #: one that actually strands a customer.
    driver_grace_minutes: int = Field(default=15, ge=0, le=240)
    driver_grace_penalty: float = Field(default=150, ge=0, le=10_000)
    driver_late_penalty: float = Field(default=300, ge=0, le=10_000)
    #: Hours before pickup that counts as "late".
    driver_late_hours: int = Field(default=1, ge=0, le=48)
    #: Charged when a driver drops a trip inside the late window.
    driver_critical_penalty: float = Field(default=500, ge=0, le=20_000)


class PaymentOptionSettings(ApiModel):
    """Which of the three ways to pay a customer may choose at booking.

    Mirrors what the market offers: settle with the driver, secure the seat
    with a part payment, or pay the whole fare now.
    """

    allow_pay_later: bool = True
    allow_part_payment: bool = True
    allow_full_payment: bool = True
    #: Which option is pre-selected and badged as recommended.
    recommended: str = Field(default="part", max_length=12)

    # Note there is deliberately no separate "part payment percent" here. A
    # part payment IS the advance, so it reads `advance.percent` and its floor
    # and ceiling. Two knobs that both mean "how much up front" would drift
    # apart and nobody would know which one applied.


class PrivacySettings(ApiModel):
    """Contact points and dates shown on the policy pages."""

    policy_updated: str = Field(default="24 September 2026", max_length=40)
    grievance_officer: str = Field(default="Operations Manager", max_length=120)
    grievance_email: str = Field(default="privacy@nearmecab.in", max_length=120)


class SettingsPayload(ApiModel):
    company: CompanySettings = Field(default_factory=CompanySettings)
    pricing: PricingSettings = Field(default_factory=PricingSettings)
    booking: BookingSettings = Field(default_factory=BookingSettings)
    advance: AdvanceSettings = Field(default_factory=AdvanceSettings)
    wallet: WalletSettings = Field(default_factory=WalletSettings)
    cancellation: CancellationSettings = Field(default_factory=CancellationSettings)
    payment_options: PaymentOptionSettings = Field(default_factory=PaymentOptionSettings)
    privacy: PrivacySettings = Field(default_factory=PrivacySettings)


class SettingsUpdate(ApiModel):
    company: CompanySettings | None = None
    pricing: PricingSettings | None = None
    booking: BookingSettings | None = None
    advance: AdvanceSettings | None = None
    wallet: WalletSettings | None = None
    cancellation: CancellationSettings | None = None
    payment_options: PaymentOptionSettings | None = None
    privacy: PrivacySettings | None = None


class SupportRequest(ApiModel):
    subject: str = Field(min_length=3, max_length=120)
    message: str = Field(min_length=10, max_length=2000)
    booking_id: str | None = Field(default=None, max_length=40)
    contact_phone: Phone | None = None
    contact_email: EmailStr | None = None


class SuspendRequest(ApiModel):
    suspended: bool
    reason: str | None = Field(default=None, max_length=300)
