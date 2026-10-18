"""Request contracts for the no-login website.

Note what a caller cannot send: a fare, a status, a customer id, or a payment
option. `extra="forbid"` on ApiModel turns an attempt into a 422 rather than a
field quietly ignored — which matters more here than anywhere else in the API,
because nothing behind these endpoints has been authenticated.
"""

from __future__ import annotations

import datetime as dt

from pydantic import EmailStr, Field

from app.models.enums import TripType, VehicleType
from app.schemas.common import ApiModel, Phone


class PublicBookingRequest(ApiModel):
    name: str = Field(min_length=2, max_length=80)
    phone: Phone
    email: EmailStr | None = None

    pickup: str = Field(min_length=2, max_length=200)
    drop: str = Field(min_length=2, max_length=200)
    route_id: str | None = Field(default=None, max_length=40)

    trip_type: TripType = TripType.ONE_WAY
    vehicle_type: VehicleType
    scheduled_at: dt.datetime
    passenger_count: int = Field(default=1, ge=1, le=30)
    notes: str | None = Field(default=None, max_length=500)
