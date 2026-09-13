"""Request/response contracts for online payments.

Note what is absent from `PaymentIntentRequest`: an amount for anything but a
wallet top-up. A customer says *which* booking they are paying for, never how
much — the server derives that from the booking. `extra="forbid"` on ApiModel
means a payload that tries to smuggle one in is rejected outright rather than
having the field quietly ignored.
"""

from __future__ import annotations

from pydantic import BaseModel, Field

from app.schemas.common import ApiModel


class PaymentIntentRequest(ApiModel):
    #: advance | balance | wallet_topup
    purpose: str = Field(max_length=20)
    booking_id: str | None = Field(default=None, max_length=40)
    #: Only meaningful for a wallet top-up, where the driver chooses how much
    #: to deposit. Ignored — and rejected as unnecessary — for fare payments.
    amount: float | None = Field(default=None, gt=0, le=200_000)


class PaymentIntentResponse(BaseModel):
    order_id: str
    amount: float
    amount_paise: int
    currency: str
    key_id: str
    purpose: str
    name: str | None = None
    email: str | None = None
    phone: str | None = None


class CheckoutCallback(ApiModel):
    """What Razorpay Checkout hands back to the browser on success.

    Field names mirror Razorpay's own so the frontend can forward the handler
    payload untouched, with no renaming step to get wrong.
    """

    razorpay_order_id: str = Field(max_length=80)
    razorpay_payment_id: str = Field(max_length=80)
    razorpay_signature: str = Field(max_length=200)


class PaymentApplied(BaseModel):
    applied: bool
    status: str
    purpose: str
