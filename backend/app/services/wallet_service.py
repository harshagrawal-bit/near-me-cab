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
