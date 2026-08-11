"""Domain vocabulary shared by services, schemas and the seed script."""

from __future__ import annotations

from enum import Enum


class StrEnum(str, Enum):
    def __str__(self) -> str:  # pragma: no cover - convenience only
        return self.value


class Role(StrEnum):
    CUSTOMER = "customer"
    DRIVER = "driver"
    ADMIN = "admin"


class AccountStatus(StrEnum):
    ACTIVE = "active"
    SUSPENDED = "suspended"


class TripType(StrEnum):
    ONE_WAY = "one_way"
    ROUND_TRIP = "round_trip"
    LOCAL = "local"
    AIRPORT = "airport"


class VehicleType(StrEnum):
    HATCHBACK = "hatchback"
    SEDAN = "sedan"
    SUV = "suv"
    PREMIUM = "premium"
    TEMPO = "tempo"


class VehicleStatus(StrEnum):
    AVAILABLE = "available"
    ASSIGNED = "assigned"
    ON_TRIP = "on_trip"
    MAINTENANCE = "maintenance"
    INACTIVE = "inactive"


class DriverStatus(StrEnum):
    ACTIVE = "active"
    INACTIVE = "inactive"


class DriverType(StrEnum):
    """Who the driver record belongs to.

    An OWNER signs themselves up, keeps a security deposit, owns vehicles and
    may employ others. An EMPLOYED driver is added by an owner, has a login of
    their own, holds no deposit, and only ever sees trips assigned to them.
    A one-person operation is simply an OWNER who drives their own trips.
    """

    OWNER = "owner"
    EMPLOYED = "employed"


class WalletTxnType(StrEnum):
    """Every movement of money in a driver wallet, as an append-only ledger.

    HOLD ring-fences funds while a trip is live; RELEASE returns them when it
    ends. Balance is derived from, and must always agree with, these rows.
    """

    DEPOSIT = "deposit"
    WITHDRAWAL = "withdrawal"
    HOLD = "hold"
    RELEASE = "release"
    COMMISSION = "commission"
    ADJUSTMENT = "adjustment"


class AdvanceStatus(StrEnum):
    """State of the customer's up-front deposit on a booking."""

    NOT_REQUIRED = "not_required"
    PENDING = "pending"
    PAID = "paid"
    REFUNDED = "refunded"


class VerificationStatus(StrEnum):
    PENDING = "pending"
    VERIFIED = "verified"
    REJECTED = "rejected"


class DocumentStatus(StrEnum):
    VERIFIED = "verified"
    PENDING = "pending"
    EXPIRED = "expired"


class BookingStatus(StrEnum):
    REQUESTED = "requested"
    #: Admin has confirmed a car is available; waiting on the customer's advance.
    AWAITING_PAYMENT = "awaiting_payment"
    CONFIRMED = "confirmed"
    DRIVER_ASSIGNED = "driver_assigned"
    ACCEPTED = "accepted"
    DRIVER_ARRIVING = "driver_arriving"
    PICKED_UP = "picked_up"
    TRIP_STARTED = "trip_started"
    COMPLETED = "completed"
    CANCELLED = "cancelled"


class PaymentStatus(StrEnum):
    PENDING = "pending"
    PAID = "paid"
    PARTIALLY_PAID = "partially_paid"
    FAILED = "failed"
    REFUNDED = "refunded"
    CASH = "cash"


class PaymentMethod(StrEnum):
    CASH = "cash"
    UPI = "upi"
    CARD = "card"
    NETBANKING = "netbanking"
    WALLET = "wallet"


class PaymentProvider(StrEnum):
    MANUAL = "manual"
    RAZORPAY = "razorpay"


class DiscountType(StrEnum):
    PERCENT = "percent"
    FLAT = "flat"


class NotificationType(StrEnum):
    BOOKING_CREATED = "booking_created"
    BOOKING_CONFIRMED = "booking_confirmed"
    DRIVER_ASSIGNED = "driver_assigned"
    TRIP_UPDATE = "trip_update"
    TRIP_COMPLETED = "trip_completed"
    BOOKING_CANCELLED = "booking_cancelled"
    ACCOUNT = "account"
    SYSTEM = "system"


class NotificationChannel(StrEnum):
    """Channels the abstraction supports. Only IN_APP is actually delivered today."""

    IN_APP = "in_app"
    EMAIL = "email"
    SMS = "sms"
    PUSH = "push"
    WHATSAPP = "whatsapp"


# ---------------------------------------------------------------------------
# Booking state machine
# ---------------------------------------------------------------------------

#: Ordered "happy path" used for progress calculation and timeline rendering.
BOOKING_PROGRESSION: tuple[BookingStatus, ...] = (
    BookingStatus.REQUESTED,
    BookingStatus.AWAITING_PAYMENT,
    BookingStatus.CONFIRMED,
    BookingStatus.DRIVER_ASSIGNED,
    BookingStatus.ACCEPTED,
    BookingStatus.DRIVER_ARRIVING,
    BookingStatus.PICKED_UP,
    BookingStatus.TRIP_STARTED,
    BookingStatus.COMPLETED,
)

#: Allowed transitions. Anything not listed here is rejected by the service layer.
BOOKING_TRANSITIONS: dict[BookingStatus, set[BookingStatus]] = {
    # Straight to CONFIRMED is still legal — that is the path when the advance
    # is switched off in settings, so turning the feature off needs no migration.
    BookingStatus.REQUESTED: {
        BookingStatus.AWAITING_PAYMENT,
        BookingStatus.CONFIRMED,
        BookingStatus.CANCELLED,
    },
    BookingStatus.AWAITING_PAYMENT: {BookingStatus.CONFIRMED, BookingStatus.CANCELLED},
    BookingStatus.CONFIRMED: {BookingStatus.DRIVER_ASSIGNED, BookingStatus.CANCELLED},
    BookingStatus.DRIVER_ASSIGNED: {
        BookingStatus.ACCEPTED,
        BookingStatus.DRIVER_ASSIGNED,  # reassignment keeps the same state
        BookingStatus.CANCELLED,
    },
    BookingStatus.ACCEPTED: {
        BookingStatus.DRIVER_ARRIVING,
        BookingStatus.DRIVER_ASSIGNED,  # admin reassignment
        BookingStatus.CANCELLED,
    },
    BookingStatus.DRIVER_ARRIVING: {
        BookingStatus.PICKED_UP,
        BookingStatus.DRIVER_ASSIGNED,
        BookingStatus.CANCELLED,
    },
    BookingStatus.PICKED_UP: {BookingStatus.TRIP_STARTED, BookingStatus.CANCELLED},
    BookingStatus.TRIP_STARTED: {BookingStatus.COMPLETED},
    BookingStatus.COMPLETED: set(),
    BookingStatus.CANCELLED: set(),
}

#: Statuses a driver is permitted to set on their own assigned trip.
DRIVER_ALLOWED_TRANSITIONS: set[BookingStatus] = {
    BookingStatus.ACCEPTED,
    BookingStatus.DRIVER_ARRIVING,
    BookingStatus.PICKED_UP,
    BookingStatus.TRIP_STARTED,
    BookingStatus.COMPLETED,
}

#: Customers may cancel only while the trip has not physically begun.
CUSTOMER_CANCELLABLE: set[BookingStatus] = {
    BookingStatus.REQUESTED,
    BookingStatus.AWAITING_PAYMENT,
    BookingStatus.CONFIRMED,
    BookingStatus.DRIVER_ASSIGNED,
    BookingStatus.ACCEPTED,
}

ACTIVE_BOOKING_STATUSES: set[BookingStatus] = {
    BookingStatus.DRIVER_ASSIGNED,
    BookingStatus.ACCEPTED,
    BookingStatus.DRIVER_ARRIVING,
    BookingStatus.PICKED_UP,
    BookingStatus.TRIP_STARTED,
}

UPCOMING_BOOKING_STATUSES: set[BookingStatus] = {
    BookingStatus.REQUESTED,
    BookingStatus.AWAITING_PAYMENT,
    BookingStatus.CONFIRMED,
}

TERMINAL_BOOKING_STATUSES: set[BookingStatus] = {
    BookingStatus.COMPLETED,
    BookingStatus.CANCELLED,
}

#: Human labels reused by the API and notification copy.
BOOKING_STATUS_LABELS: dict[str, str] = {
    BookingStatus.REQUESTED: "Requested",
    BookingStatus.AWAITING_PAYMENT: "Awaiting Advance",
    BookingStatus.CONFIRMED: "Confirmed",
    BookingStatus.DRIVER_ASSIGNED: "Driver Assigned",
    BookingStatus.ACCEPTED: "Accepted by Driver",
    BookingStatus.DRIVER_ARRIVING: "Driver Arriving",
    BookingStatus.PICKED_UP: "Customer Picked Up",
    BookingStatus.TRIP_STARTED: "Trip Started",
    BookingStatus.COMPLETED: "Completed",
    BookingStatus.CANCELLED: "Cancelled",
}


def can_transition(current: str, target: str) -> bool:
    try:
        return BookingStatus(target) in BOOKING_TRANSITIONS[BookingStatus(current)]
    except (KeyError, ValueError):
        return False
