"""/api/reviews — customers rate completed trips; admins moderate."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Query, status

from app.api.deps import AdminUser, CurrentUser, CustomerUser, Pagination
from app.core.rate_limit import write_rate_limit
from app.models.enums import Role
from app.schemas.booking import ReviewCreate, ReviewModerate
from app.schemas.common import Message, object_id
from app.services import review_service

router = APIRouter(prefix="/reviews", tags=["reviews"])


@router.post(
    "",
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(write_rate_limit)],
    summary="Review a completed trip (customer)",
)
async def create_review(payload: ReviewCreate, customer: CustomerUser) -> dict:
    return await review_service.create_review(customer, payload)


@router.get("/pending", summary="Completed trips awaiting my review (customer)")
async def pending(customer: CustomerUser) -> list[dict]:
    return await review_service.reviewable_bookings(customer["_id"])


@router.get("", summary="List reviews")
async def list_reviews(
    user: CurrentUser,
    page_params: Pagination,
    driver_id: str | None = Query(None),
    is_published: bool | None = Query(None),
    min_rating: int | None = Query(None, ge=1, le=5),
) -> dict:
    # Only admins may look at unpublished (moderated) reviews.
    effective_published = is_published if user["role"] == Role.ADMIN.value else True
    return await review_service.list_reviews(
        page_params.page,
        page_params.page_size,
        driver_id=object_id(driver_id, "driver_id") if driver_id else None,
        is_published=effective_published,
        min_rating=min_rating,
    )


@router.patch("/{review_id}", summary="Publish or hide a review (admin)")
async def moderate(review_id: str, payload: ReviewModerate, admin: AdminUser) -> dict:
    return await review_service.moderate(object_id(review_id, "review_id"), payload)


@router.delete("/{review_id}", response_model=Message, summary="Delete a review (admin)")
async def delete_review(review_id: str, admin: AdminUser) -> Message:
    await review_service.delete_review(object_id(review_id, "review_id"))
    return Message(detail="Review deleted.")
