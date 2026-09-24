"""/api/fleet — what a driver or fleet owner can do for themselves.

Every route here resolves the *stored* driver record from the signed-in user
and checks authority against that. The client never states which fleet it
belongs to, so it cannot claim someone else's.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, Query, status

from app.api.deps import CurrentUser, require_roles
from app.core.rate_limit import write_rate_limit
from app.models.enums import Role
from app.schemas.common import Message, object_id
from app.schemas.wallet import (
    BankDetails,
    BookingAcceptance,
    DocumentUpload,
    OwnerVehicleCreate,
    SubDriverCreate,
    WalletSummary,
)
from app.services import driver_service, fleet_service, wallet_service

router = APIRouter(
    prefix="/fleet",
    tags=["fleet"],
    dependencies=[Depends(require_roles(Role.DRIVER))],
)


# ---------------------------------------------------------------------------
# Wallet
# ---------------------------------------------------------------------------


@router.get("/wallet", response_model=WalletSummary, summary="My wallet")
async def my_wallet(user: CurrentUser) -> WalletSummary:
    driver = await driver_service.require_driver_for_user(user["_id"])
    return WalletSummary(**await wallet_service.eligibility(driver))


@router.get("/wallet/transactions", summary="My wallet statement")
async def my_statement(user: CurrentUser, page: int = 1, page_size: int = 20) -> dict:
    driver = await driver_service.require_driver_for_user(user["_id"])
    return await wallet_service.statement(
        driver["_id"], page=max(1, page), page_size=min(max(1, page_size), 100)
    )


# ---------------------------------------------------------------------------
# Employed drivers
# ---------------------------------------------------------------------------


@router.post(
    "/wallet/withdraw",
    dependencies=[Depends(write_rate_limit)],
    summary="Request money back from my wallet",
)
async def request_withdrawal(
    user: CurrentUser,
    amount: float = Query(gt=0, le=1_000_000),
    note: str | None = Query(None, max_length=200),
) -> dict:
    """Ask for a withdrawal. An admin settles it and approves, which is what
    actually debits the wallet — there is no automatic payout."""
    driver = await driver_service.require_driver_for_user(user["_id"])
    return await wallet_service.request_withdrawal(driver["_id"], amount, note=note)


@router.get("/wallet/withdrawals", summary="My withdrawal requests")
async def my_withdrawals(user: CurrentUser) -> dict:
    driver = await driver_service.require_driver_for_user(user["_id"])
    return {"items": await wallet_service.list_withdrawals(driver["_id"])}


@router.get("/bank-details", summary="My payout account")
async def my_bank_details(user: CurrentUser) -> dict:
    driver = await driver_service.require_driver_for_user(user["_id"])
    return {"bank_details": wallet_service.mask_bank_details(driver.get("bank_details"))}


@router.put(
    "/bank-details",
    dependencies=[Depends(write_rate_limit)],
    summary="Set where my withdrawals are paid",
)
async def set_bank_details(payload: BankDetails, user: CurrentUser) -> dict:
    """Needed because a gateway refund can only send money back the way it
    came. Paying a driver who never paid us is a bank transfer, not a refund."""
    driver = await driver_service.require_driver_for_user(user["_id"])
    return {"bank_details": await wallet_service.set_bank_details(driver["_id"], payload)}


@router.get("/drivers", summary="Drivers working under me")
async def my_drivers(user: CurrentUser) -> dict:
    owner = await fleet_service.require_owner(user["_id"])
    return {"items": await fleet_service.list_sub_drivers(owner)}


@router.post(
    "/drivers",
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(write_rate_limit)],
    summary="Add a driver to my fleet",
)
async def add_driver(payload: SubDriverCreate, user: CurrentUser) -> dict:
    owner = await fleet_service.require_owner(user["_id"])
    return await fleet_service.add_sub_driver(owner, payload)


@router.patch("/drivers/{driver_id}/status", summary="Activate or suspend one of my drivers")
async def set_driver_status(driver_id: str, active: bool, user: CurrentUser) -> dict:
    owner = await fleet_service.require_owner(user["_id"])
    return await fleet_service.set_sub_driver_status(
        owner, object_id(driver_id, "driver_id"), active
    )


# ---------------------------------------------------------------------------
# Vehicles
# ---------------------------------------------------------------------------


@router.get("/vehicles", summary="My vehicles")
async def my_vehicles(user: CurrentUser) -> dict:
    owner = await fleet_service.require_owner(user["_id"])
    return {"items": await fleet_service.list_vehicles(owner)}


@router.post(
    "/vehicles",
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(write_rate_limit)],
    summary="Add a vehicle",
)
async def add_vehicle(payload: OwnerVehicleCreate, user: CurrentUser) -> dict:
    owner = await fleet_service.require_owner(user["_id"])
    return await fleet_service.add_vehicle(owner, payload)


@router.delete("/vehicles/{vehicle_id}", response_model=Message, summary="Remove a vehicle")
async def remove_vehicle(vehicle_id: str, user: CurrentUser) -> Message:
    owner = await fleet_service.require_owner(user["_id"])
    await fleet_service.remove_vehicle(owner, object_id(vehicle_id, "vehicle_id"))
    return Message(detail="Vehicle removed.")


# ---------------------------------------------------------------------------
# Documents
# ---------------------------------------------------------------------------


@router.post(
    "/documents",
    dependencies=[Depends(write_rate_limit)],
    summary="Submit a document for verification",
)
async def submit_document(payload: DocumentUpload, user: CurrentUser) -> dict:
    driver = await driver_service.require_driver_for_user(user["_id"])
    return await fleet_service.upload_document(driver["_id"], payload)


# ---------------------------------------------------------------------------
# Work
# ---------------------------------------------------------------------------


@router.get("/open-bookings", summary="Confirmed trips I could accept")
async def open_bookings(user: CurrentUser) -> dict:
    owner = await fleet_service.require_owner(user["_id"])
    return {"items": await fleet_service.open_bookings(owner)}


@router.post(
    "/open-bookings/{booking_id}/accept",
    dependencies=[Depends(write_rate_limit)],
    summary="Accept a trip with a chosen vehicle and driver",
)
async def accept_booking(
    booking_id: str, payload: BookingAcceptance, user: CurrentUser
) -> dict:
    owner = await fleet_service.require_owner(user["_id"])
    return await fleet_service.accept_booking(
        owner, object_id(booking_id, "booking_id"), payload
    )
