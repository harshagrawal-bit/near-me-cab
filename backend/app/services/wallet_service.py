"""Driver wallet: security deposit, per-ride holds, and an append-only ledger.

Two numbers govern whether a fleet owner may take work:

* a **floor** (`wallet.min_balance`, ₹800 by default) they must keep at all
  times to remain eligible at all, and
* a **per-ride requirement** that a specific trip ties up while it is live.

`required_for_booking` is the single place the per-ride rule lives. The real
formula is still being decided, so today it is a documented placeholder driven
entirely by admin settings — swapping it means changing that one function and
nothing else.

Balance is stored on the driver document so it can be moved atomically with
`$inc`, and every movement is also written to `wallet_transactions`. The two
must always agree; `reconcile` proves it.
"""

from __future__ import annotations

from typing import Any

from bson import ObjectId

from app.core.errors import ConflictError, NotFoundError, ValidationError
from app.db import mongodb
from app.models.enums import WalletTxnType
from app.schemas.common import serialize, utcnow


def _oid(value: ObjectId | str) -> ObjectId:
    return value if isinstance(value, ObjectId) else ObjectId(str(value))


# ---------------------------------------------------------------------------
# The rule
# ---------------------------------------------------------------------------


def required_for_booking(booking: dict[str, Any], wallet_settings: Any) -> float:
    """How much a driver must have available to accept this trip.

    PLACEHOLDER — replace the body when the real formula is specified. Keep the
    signature: callers depend on it, and `test_wallet.py` pins the behaviour
    that a bigger fare demands a bigger hold.

    Today: a percentage of the fare, clamped to a floor and an optional ceiling.
    """
    fare = float(booking.get("total_fare") or 0)
    required = fare * float(wallet_settings.per_ride_percent) / 100
    required = max(required, float(wallet_settings.per_ride_min))
    ceiling = float(wallet_settings.per_ride_max or 0)
    if ceiling > 0:
        required = min(required, ceiling)
    return round(required, 2)


async def eligibility(driver: dict[str, Any], booking: dict[str, Any] | None = None) -> dict:
    """Explain, in one object, whether this driver may take this trip.

    Returns the reason rather than a bare boolean so the driver app can tell
    someone *how much* they are short instead of just refusing.
    """
    from app.services import settings_service

    settings = await settings_service.get_settings()
    wallet = settings.wallet

    balance = float(driver.get("wallet_balance") or 0)
    held = float(driver.get("wallet_held") or 0)
    available = round(balance - held, 2)

    floor = float(wallet.min_balance)
    meets_floor = balance >= floor

    required = required_for_booking(booking, wallet) if booking else 0.0
    meets_ride = available >= required

    if not meets_floor:
        reason = (
            f"Your wallet balance is below the ₹{floor:,.0f} minimum. "
            f"Add ₹{floor - balance:,.0f} to start accepting trips."
        )
    elif booking and not meets_ride:
        reason = (
            f"This trip needs ₹{required:,.0f} available. "
            f"You have ₹{available:,.0f}. Add ₹{required - available:,.0f}."
        )
    else:
        reason = ""

    return {
        "balance": round(balance, 2),
        "held": round(held, 2),
        "available": available,
        "min_balance": floor,
        "required_for_trip": required,
        # How far short they are, worked out here rather than in the app: the
        # rule is one thing, and two copies of it drift.
        "shortfall": round(max(0.0, floor - balance), 2),
        "eligible": meets_floor and meets_ride,
        "reason": reason,
        "driver_id": str(driver["_id"]) if driver.get("_id") else None,
        "driver_type": driver.get("driver_type"),
    }


# ---------------------------------------------------------------------------
# Ledger
# ---------------------------------------------------------------------------


async def _record(
    *,
    driver_id: ObjectId,
    txn_type: WalletTxnType,
    amount: float,
    balance_after: float,
    held_after: float,
    booking_id: ObjectId | None = None,
    note: str | None = None,
    actor_id: str | None = None,
    is_open: bool = False,
) -> dict[str, Any]:
    doc = {
        "driver_id": driver_id,
        "type": txn_type.value,
        "amount": round(float(amount), 2),
        "balance_after": round(float(balance_after), 2),
        "held_after": round(float(held_after), 2),
        "booking_id": booking_id,
        "note": note,
        "actor_id": ObjectId(actor_id) if actor_id else None,
        # Only HOLD rows are ever "open"; RELEASE closes the matching one.
        "is_open": is_open,
        "created_at": utcnow(),
    }
    result = await mongodb.wallet_transactions().insert_one(doc)
    doc["_id"] = result.inserted_id
    return doc


async def _driver(driver_id: ObjectId) -> dict[str, Any]:
    driver = await mongodb.drivers().find_one({"_id": driver_id})
    if not driver:
        raise NotFoundError("Driver not found.")
    return driver


async def credit(
    driver_id: ObjectId | str,
    amount: float,
    *,
    txn_type: WalletTxnType = WalletTxnType.DEPOSIT,
    note: str | None = None,
    actor_id: str | None = None,
    booking_id: ObjectId | None = None,
) -> dict[str, Any]:
    """Add money to a wallet."""
    if amount <= 0:
        raise ValidationError("Amount must be greater than zero.")
    oid = _oid(driver_id)
    updated = await mongodb.drivers().find_one_and_update(
        {"_id": oid},
        {"$inc": {"wallet_balance": round(float(amount), 2)}, "$set": {"updated_at": utcnow()}},
        return_document=True,
    )
    if not updated:
        raise NotFoundError("Driver not found.")
    return serialize(
        await _record(
            driver_id=oid,
            txn_type=txn_type,
            amount=amount,
            balance_after=updated.get("wallet_balance", 0),
            held_after=updated.get("wallet_held", 0),
            booking_id=booking_id,
            note=note,
            actor_id=actor_id,
        )
    )


async def debit(
    driver_id: ObjectId | str,
    amount: float,
    *,
    txn_type: WalletTxnType = WalletTxnType.WITHDRAWAL,
    note: str | None = None,
    actor_id: str | None = None,
    booking_id: ObjectId | None = None,
) -> dict[str, Any]:
    """Take money out, refusing to spend funds that are held or absent.

    The guard lives in the query filter, not in Python: two concurrent debits
    both reading a ₹1,000 balance would each think they could take ₹800.
    Matching on the balance makes the database the referee.
    """
    if amount <= 0:
        raise ValidationError("Amount must be greater than zero.")
    oid = _oid(driver_id)
    amount = round(float(amount), 2)

    driver = await _driver(oid)
    held = float(driver.get("wallet_held") or 0)

    updated = await mongodb.drivers().find_one_and_update(
        {"_id": oid, "$expr": {"$gte": [{"$subtract": ["$wallet_balance", held]}, amount]}},
        {"$inc": {"wallet_balance": -amount}, "$set": {"updated_at": utcnow()}},
        return_document=True,
    )
    if not updated:
        raise ConflictError("Insufficient available wallet balance.")
    return serialize(
        await _record(
            driver_id=oid,
            txn_type=txn_type,
            amount=-amount,
            balance_after=updated.get("wallet_balance", 0),
            held_after=updated.get("wallet_held", 0),
            booking_id=booking_id,
            note=note,
            actor_id=actor_id,
        )
    )


async def hold(driver_id: ObjectId | str, booking_id: ObjectId, amount: float) -> dict[str, Any]:
    """Ring-fence funds for a live trip. Money stays in the wallet but is unusable."""
    oid = _oid(driver_id)
    amount = round(float(amount), 2)
    if amount <= 0:
        return {}

    existing = await mongodb.wallet_transactions().find_one(
        {"driver_id": oid, "booking_id": booking_id, "type": WalletTxnType.HOLD.value,
         "is_open": True}
    )
    if existing:
        # Re-accepting the same trip must not stack a second hold.
        return serialize(existing)

    updated = await mongodb.drivers().find_one_and_update(
        {
            "_id": oid,
            "$expr": {
                "$gte": [
                    {"$subtract": ["$wallet_balance", {"$ifNull": ["$wallet_held", 0]}]},
                    amount,
                ]
            },
        },
        {"$inc": {"wallet_held": amount}, "$set": {"updated_at": utcnow()}},
        return_document=True,
    )
    if not updated:
        raise ConflictError("Insufficient available wallet balance to accept this trip.")
    return serialize(
        await _record(
            driver_id=oid,
            txn_type=WalletTxnType.HOLD,
            amount=amount,
            balance_after=updated.get("wallet_balance", 0),
            held_after=updated.get("wallet_held", 0),
            booking_id=booking_id,
            note="Held for trip",
            is_open=True,
        )
    )


async def release(driver_id: ObjectId | str, booking_id: ObjectId) -> dict[str, Any]:
    """Return a hold once the trip is finished or cancelled. Idempotent."""
    oid = _oid(driver_id)
    open_hold = await mongodb.wallet_transactions().find_one_and_update(
        {"driver_id": oid, "booking_id": booking_id, "type": WalletTxnType.HOLD.value,
         "is_open": True},
        {"$set": {"is_open": False, "released_at": utcnow()}},
        return_document=False,
    )
    if not open_hold:
        return {}

    amount = float(open_hold.get("amount") or 0)
    updated = await mongodb.drivers().find_one_and_update(
        {"_id": oid},
        {"$inc": {"wallet_held": -amount}, "$set": {"updated_at": utcnow()}},
        return_document=True,
    )
    return serialize(
        await _record(
            driver_id=oid,
            txn_type=WalletTxnType.RELEASE,
            amount=amount,
            balance_after=(updated or {}).get("wallet_balance", 0),
            held_after=(updated or {}).get("wallet_held", 0),
            booking_id=booking_id,
            note="Hold released",
        )
    )


async def statement(driver_id: ObjectId | str, page: int = 1, page_size: int = 20) -> dict:
    oid = _oid(driver_id)
    query = {"driver_id": oid}
    total = await mongodb.wallet_transactions().count_documents(query)
    cursor = (
        mongodb.wallet_transactions()
        .find(query)
        .sort("created_at", -1)
        .skip((page - 1) * page_size)
        .limit(page_size)
    )
    items = [serialize(doc) async for doc in cursor]
    return {
        "items": items,
        "total": total,
        "page": page,
        "page_size": page_size,
        "pages": max(1, -(-total // page_size)),
    }


async def reconcile(driver_id: ObjectId | str) -> dict[str, Any]:
    """Prove the stored balance matches the ledger.

    Money that only exists as a single mutable number is money you cannot
    audit. This recomputes from the transaction rows so a drift is detectable
    rather than silent.
    """
    oid = _oid(driver_id)
    ledger = 0.0
    open_holds = 0.0
    async for txn in mongodb.wallet_transactions().find({"driver_id": oid}):
        kind = txn.get("type")
        amount = float(txn.get("amount") or 0)
        if kind in (WalletTxnType.HOLD.value, WalletTxnType.RELEASE.value):
            if kind == WalletTxnType.HOLD.value and txn.get("is_open"):
                open_holds += amount
            continue  # holds do not change the balance, only its availability
        ledger += amount

    driver = await _driver(oid)
    stored = float(driver.get("wallet_balance") or 0)
    stored_held = float(driver.get("wallet_held") or 0)
    return {
        "stored_balance": round(stored, 2),
        "ledger_balance": round(ledger, 2),
        "balance_matches": abs(stored - ledger) < 0.01,
        "stored_held": round(stored_held, 2),
        "open_holds": round(open_holds, 2),
        "held_matches": abs(stored_held - open_holds) < 0.01,
    }


# ---------------------------------------------------------------------------
# Withdrawals
# ---------------------------------------------------------------------------
#
# Money does not leave on a driver's say-so. There is no payout integration, so
# a withdrawal is a *request* an admin settles by an actual bank transfer and
# then approves here. Approving is what debits the wallet, which keeps the
# ledger honest: the balance only drops when the money really moved.


async def request_withdrawal(
    driver_id: ObjectId | str, amount: float, *, note: str | None = None
) -> dict[str, Any]:
    """Ask for money back. Held funds are not available and neither is a second
    open request."""
    oid = _oid(driver_id)
    driver = await _driver(oid)

    amount = round(float(amount), 2)
    if amount <= 0:
        raise ValidationError("Enter an amount to withdraw.")

    balance = float(driver.get("wallet_balance") or 0)
    held = float(driver.get("wallet_held") or 0)
    available = round(balance - held, 2)
    if amount > available:
        raise ValidationError(
            f"You can withdraw up to ₹{available:,.0f}. "
            f"₹{held:,.0f} is held against trips in progress."
        )

    existing = await mongodb.withdrawal_requests().find_one(
        {"driver_id": oid, "status": "pending"}
    )
    if existing:
        raise ConflictError("You already have a withdrawal request waiting for approval.")

    now = utcnow()
    doc = {
        "driver_id": oid,
        "amount": amount,
        "status": "pending",
        "note": note,
        "created_at": now,
        "updated_at": now,
    }
    result = await mongodb.withdrawal_requests().insert_one(doc)
    doc["_id"] = result.inserted_id
    return serialize(doc)


async def list_withdrawals(
    driver_id: ObjectId | str | None = None, status: str | None = None
) -> list[dict[str, Any]]:
    query: dict[str, Any] = {}
    if driver_id is not None:
        query["driver_id"] = _oid(driver_id)
    if status:
        query["status"] = status
    cursor = mongodb.withdrawal_requests().find(query).sort("created_at", -1).limit(200)
    return [serialize(doc) async for doc in cursor]


async def approve_withdrawal(
    request_id: ObjectId | str, *, actor_id: ObjectId | str, reference: str | None = None
) -> dict[str, Any]:
    """Debit the wallet once the transfer has actually been made.

    Availability is re-checked here, not trusted from request time: holds may
    have been placed while the request sat in the queue.
    """
    oid = _oid(request_id)
    request = await mongodb.withdrawal_requests().find_one({"_id": oid, "status": "pending"})
    if not request:
        raise NotFoundError("No pending withdrawal request with that id.")

    driver = await _driver(request["driver_id"])
    available = round(
        float(driver.get("wallet_balance") or 0) - float(driver.get("wallet_held") or 0), 2
    )
    if float(request["amount"]) > available:
        raise ConflictError(
            f"Only ₹{available:,.0f} is available now — funds were held after this request."
        )

    await debit(
        request["driver_id"],
        float(request["amount"]),
        txn_type=WalletTxnType.WITHDRAWAL,
        note=reference or "Withdrawal paid out",
        actor_id=str(actor_id),
    )
    now = utcnow()
    updated = await mongodb.withdrawal_requests().find_one_and_update(
        {"_id": oid, "status": "pending"},
        {
            "$set": {
                "status": "paid",
                "reference": reference,
                "decided_by": _oid(actor_id),
                "decided_at": now,
                "updated_at": now,
            }
        },
        return_document=True,
    )
    return serialize(updated)


async def reject_withdrawal(
    request_id: ObjectId | str, *, actor_id: ObjectId | str, reason: str | None = None
) -> dict[str, Any]:
    """Decline a request. Nothing is debited, so nothing needs undoing."""
    now = utcnow()
    updated = await mongodb.withdrawal_requests().find_one_and_update(
        {"_id": _oid(request_id), "status": "pending"},
        {
            "$set": {
                "status": "rejected",
                "decision_reason": reason,
                "decided_by": _oid(actor_id),
                "decided_at": now,
                "updated_at": now,
            }
        },
        return_document=True,
    )
    if not updated:
        raise NotFoundError("No pending withdrawal request with that id.")
    return serialize(updated)


# ---------------------------------------------------------------------------
# Penalties and payouts
# ---------------------------------------------------------------------------


def penalty_for_cancellation(
    *, accepted_at: Any, scheduled_at: Any, settings: Any, now: Any, total_fare: float = 0.0
) -> dict[str, Any]:
    """What a driver owes for dropping a trip they had accepted.

    Time-based, because the cost to the business is: a drop seconds after
    accepting is an honest mistake, one an hour before pickup strands a
    customer who has no time to rebook. Returns the reason alongside the
    amount so the driver is told why, not just charged.
    """
    hours_to_pickup = None
    if scheduled_at is not None:
        hours_to_pickup = (scheduled_at - now).total_seconds() / 3600

    if hours_to_pickup is not None and hours_to_pickup <= float(settings.driver_late_hours):
        flat = float(settings.driver_critical_penalty)
        full_fare = round(float(total_fare or 0), 2)
        # The whole fare, because that is the whole loss: this close to pickup
        # the trip cannot be sold to anyone else. The flat figure is a floor for
        # when the fare is unknown, never a discount on a known one.
        charge = max(full_fare, flat) if settings.driver_critical_is_full_fare else flat
        return {
            "amount": round(charge, 2),
            "reason": (
                f"Cancelled within {settings.driver_late_hours} hour(s) of pickup — "
                "too late to arrange another car, so the full trip fare is charged."
                if settings.driver_critical_is_full_fare and full_fare > 0
                else f"Cancelled within {settings.driver_late_hours} hour(s) of pickup, "
                "leaving no time to arrange another car."
            ),
            "band": "critical",
        }

    if accepted_at is not None:
        minutes_since_accept = (now - accepted_at).total_seconds() / 60
        if minutes_since_accept <= float(settings.driver_grace_minutes):
            return {
                "amount": round(float(settings.driver_grace_penalty), 2),
                "reason": (
                    f"Cancelled within {settings.driver_grace_minutes} minutes of accepting."
                ),
                "band": "grace",
            }

    return {
        "amount": round(float(settings.driver_late_penalty), 2),
        "reason": "Cancelled after accepting the trip.",
        "band": "late",
    }


async def charge_penalty(
    driver_id: ObjectId | str,
    amount: float,
    *,
    reason: str,
    booking_id: ObjectId | None = None,
    actor_id: str | None = None,
) -> dict[str, Any]:
    """Take a penalty out of the wallet.

    Allowed to push the balance below the minimum — that is the point. A driver
    who owes money should be blocked from taking new work until they top up,
    which `eligibility` already enforces off the same balance.
    """
    if amount <= 0:
        return {"charged": False, "amount": 0.0}
    oid = _oid(driver_id)
    driver = await _driver(oid)

    updated = await mongodb.drivers().find_one_and_update(
        {"_id": oid},
        {"$inc": {"wallet_balance": -round(float(amount), 2)}, "$set": {"updated_at": utcnow()}},
        return_document=True,
    )
    await _record(
        driver_id=oid,
        txn_type=WalletTxnType.PENALTY,
        amount=-abs(round(float(amount), 2)),
        balance_after=updated.get("wallet_balance", 0),
        held_after=updated.get("wallet_held", 0),
        booking_id=booking_id,
        note=reason,
        actor_id=actor_id,
    )
    return {
        "charged": True,
        "amount": round(float(amount), 2),
        "balance_after": updated.get("wallet_balance", 0),
        "reason": reason,
    }


async def pay_driver(
    driver_id: ObjectId | str,
    amount: float,
    *,
    note: str | None = None,
    booking_id: ObjectId | None = None,
    actor_id: str | None = None,
) -> dict[str, Any]:
    """Credit a driver their share of a trip.

    Lands in the wallet rather than going straight to a bank account: the
    driver can then withdraw it through the normal request flow, which keeps
    one ledger for everything instead of two half-pictures.
    """
    return await credit(
        driver_id,
        amount,
        txn_type=WalletTxnType.PAYOUT,
        note=note or "Trip payout",
        actor_id=actor_id,
        booking_id=booking_id,
    )


async def set_bank_details(driver_id: ObjectId | str, payload: Any) -> dict[str, Any]:
    details = {
        "account_name": payload.account_name,
        "account_number": payload.account_number,
        "ifsc": payload.ifsc.upper(),
        "bank_name": payload.bank_name,
        "upi_id": payload.upi_id,
        "updated_at": utcnow(),
    }
    updated = await mongodb.drivers().find_one_and_update(
        {"_id": _oid(driver_id)},
        {"$set": {"bank_details": details, "updated_at": utcnow()}},
        return_document=True,
    )
    if not updated:
        raise NotFoundError("Driver not found.")
    return mask_bank_details(details)


def mask_bank_details(details: dict[str, Any] | None) -> dict[str, Any] | None:
    """Only ever return the last four digits of an account number.

    Enough for someone to confirm which account they are looking at, not
    enough for a screenshot of an admin screen to be a banking leak.
    """
    if not details:
        return None
    number = str(details.get("account_number") or "")
    return {
        "account_name": details.get("account_name"),
        "account_number_masked": f"••••{number[-4:]}" if len(number) >= 4 else "••••",
        "ifsc": details.get("ifsc"),
        "bank_name": details.get("bank_name"),
        "upi_id": details.get("upi_id"),
        "updated_at": details.get("updated_at"),
    }
