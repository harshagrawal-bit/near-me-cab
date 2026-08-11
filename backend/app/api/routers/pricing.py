"""/api/pricing — fare quotes (all roles) and the admin price book."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Query, status

from app.api.deps import AdminUser, CurrentUser
from app.core.rate_limit import write_rate_limit
from app.schemas.booking import QuoteRequest
from app.schemas.common import Message, object_id
from app.schemas.fleet import PricingUpdate, PricingUpsert
from app.services import pricing_service

router = APIRouter(prefix="/pricing", tags=["pricing"])


@router.post("/quote", summary="Fare estimate for a route")
async def quote(payload: QuoteRequest, user: CurrentUser) -> dict:
    """Server-authoritative fare options. The client never sends a price."""
    return await pricing_service.quote(
        route_id=payload.route_id,
        pickup=payload.pickup,
        drop=payload.drop,
        trip_type=payload.trip_type,
        vehicle_type=payload.vehicle_type,
        scheduled_at=payload.scheduled_at,
        coupon_code=payload.coupon_code,
    )


@router.get("", summary="Price book grouped by route (admin)")
async def list_prices(
    admin: AdminUser, route_id: str | None = Query(None)
) -> list[dict]:
    return await pricing_service.list_prices(
        object_id(route_id, "route_id") if route_id else None
    )


@router.put(
    "",
    status_code=status.HTTP_200_OK,
    dependencies=[Depends(write_rate_limit)],
    summary="Create or replace a price row (admin)",
)
async def upsert_price(payload: PricingUpsert, admin: AdminUser) -> dict:
    return await pricing_service.upsert_price(payload)


@router.patch("/{price_id}", summary="Edit a price row (admin)")
async def update_price(price_id: str, payload: PricingUpdate, admin: AdminUser) -> dict:
    return await pricing_service.update_price(object_id(price_id, "price_id"), payload)


@router.delete("/{price_id}", response_model=Message, summary="Delete a price row (admin)")
async def delete_price(price_id: str, admin: AdminUser) -> Message:
    await pricing_service.delete_price(object_id(price_id, "price_id"))
    return Message(detail="Price removed.")
