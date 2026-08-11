"""/api/vehicles — fleet management (admin)."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Query, status

from app.api.deps import AdminUser, Pagination
from app.core.rate_limit import write_rate_limit
from app.schemas.common import Message, object_id
from app.schemas.fleet import VehicleCreate, VehicleUpdate
from app.services import vehicle_service

router = APIRouter(prefix="/vehicles", tags=["vehicles"])


@router.get("", summary="List vehicles")
async def list_vehicles(
    admin: AdminUser,
    page_params: Pagination,
    search: str | None = Query(None, max_length=60),
    status_filter: str | None = Query(None, alias="status"),
    vehicle_type: str | None = Query(None),
) -> dict:
    return await vehicle_service.list_vehicles(
        page_params.page,
        page_params.page_size,
        search=search,
        status=status_filter,
        vehicle_type=vehicle_type,
    )


@router.post(
    "",
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(write_rate_limit)],
    summary="Add a vehicle",
)
async def create_vehicle(payload: VehicleCreate, admin: AdminUser) -> dict:
    return await vehicle_service.create_vehicle(payload)


@router.get("/{vehicle_id}", summary="Vehicle detail")
async def get_vehicle(vehicle_id: str, admin: AdminUser) -> dict:
    return await vehicle_service.require_vehicle(object_id(vehicle_id, "vehicle_id"))


@router.patch("/{vehicle_id}", summary="Edit a vehicle")
async def update_vehicle(vehicle_id: str, payload: VehicleUpdate, admin: AdminUser) -> dict:
    return await vehicle_service.update_vehicle(object_id(vehicle_id, "vehicle_id"), payload)


@router.delete("/{vehicle_id}", response_model=Message, summary="Delete a vehicle")
async def delete_vehicle(vehicle_id: str, admin: AdminUser) -> Message:
    await vehicle_service.delete_vehicle(object_id(vehicle_id, "vehicle_id"))
    return Message(detail="Vehicle deleted.")
