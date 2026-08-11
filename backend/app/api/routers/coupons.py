"""/api/coupons — offer management (admin) and the public offer list."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Query, status

from app.api.deps import AdminUser, CurrentUser, Pagination
from app.core.errors import ValidationError
from app.core.rate_limit import write_rate_limit
from app.schemas.booking import CouponCreate, CouponUpdate
from app.schemas.common import Message, object_id
from app.services import coupon_service

router = APIRouter(prefix="/coupons", tags=["coupons"])


@router.get("/offers", summary="Offers a customer can use right now")
async def public_offers(user: CurrentUser) -> list[dict]:
    return await coupon_service.list_public_offers()


@router.get("/validate/{code}", summary="Check a coupon code")
async def validate_coupon(code: str, user: CurrentUser) -> dict:
    coupon = await coupon_service.get_active(code)
    if not coupon:
        raise ValidationError("This coupon code is not valid or has expired.")
    return coupon_service.to_public(coupon)


@router.get("", summary="List coupons (admin)")
async def list_coupons(
    admin: AdminUser, page_params: Pagination, is_active: bool | None = Query(None)
) -> dict:
    return await coupon_service.list_coupons(
        page_params.page, page_params.page_size, is_active
    )


@router.post(
    "",
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(write_rate_limit)],
    summary="Create a coupon (admin)",
)
async def create_coupon(payload: CouponCreate, admin: AdminUser) -> dict:
    return await coupon_service.create_coupon(payload)


@router.patch("/{coupon_id}", summary="Edit a coupon (admin)")
async def update_coupon(coupon_id: str, payload: CouponUpdate, admin: AdminUser) -> dict:
    return await coupon_service.update_coupon(object_id(coupon_id, "coupon_id"), payload)


@router.delete("/{coupon_id}", response_model=Message, summary="Delete a coupon (admin)")
async def delete_coupon(coupon_id: str, admin: AdminUser) -> Message:
    await coupon_service.delete_coupon(object_id(coupon_id, "coupon_id"))
    return Message(detail="Coupon deleted.")
