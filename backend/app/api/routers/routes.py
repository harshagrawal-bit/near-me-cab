"""/api/routes — the route catalogue.

Reads are available to any signed-in user (customers need them to book);
writes are admin-only.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, Query, status

from app.api.deps import AdminUser, CurrentUser, Pagination
from app.core.rate_limit import write_rate_limit
from app.schemas.common import Message, object_id
from app.schemas.fleet import RouteCreate, RouteUpdate
from app.services import maps_service, route_service, vehicle_service

router = APIRouter(prefix="/routes", tags=["routes"])


@router.get("", summary="List routes")
async def list_routes(
    user: CurrentUser,
    page_params: Pagination,
    search: str | None = Query(None, max_length=60),
    is_active: bool | None = Query(None),
) -> dict:
    # Customers and drivers only ever see bookable routes.
    effective_active = is_active if user["role"] == "admin" else True
    return await route_service.list_routes(
        page_params.page, page_params.page_size, search=search, is_active=effective_active
    )


@router.get("/popular", summary="Most-booked routes")
async def popular(user: CurrentUser, limit: int = Query(6, ge=1, le=20)) -> list[dict]:
    return await route_service.popular_routes(limit)


@router.get("/vehicle-classes", summary="Vehicle classes offered")
async def vehicle_classes(user: CurrentUser) -> list[dict]:
    return vehicle_service.list_vehicle_classes()


@router.get("/places", summary="Place suggestions for pickup/drop inputs")
async def places(user: CurrentUser, q: str = Query("", max_length=60)) -> list[dict]:
    return await maps_service.suggest_places(q)


@router.get("/map-capabilities", summary="Which mapping features are live")
async def map_capabilities(user: CurrentUser) -> dict:
    return maps_service.capabilities()


@router.get("/{route_id}", summary="Route detail")
async def get_route(route_id: str, user: CurrentUser) -> dict:
    return await route_service.require_route(object_id(route_id, "route_id"))


@router.post(
    "",
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(write_rate_limit)],
    summary="Create a route (admin)",
)
async def create_route(payload: RouteCreate, admin: AdminUser) -> dict:
    return await route_service.create_route(payload)


@router.patch("/{route_id}", summary="Update a route (admin)")
async def update_route(route_id: str, payload: RouteUpdate, admin: AdminUser) -> dict:
    return await route_service.update_route(object_id(route_id, "route_id"), payload)


@router.delete("/{route_id}", response_model=Message, summary="Delete a route (admin)")
async def delete_route(route_id: str, admin: AdminUser) -> Message:
    await route_service.delete_route(object_id(route_id, "route_id"))
    return Message(detail="Route deleted.")
