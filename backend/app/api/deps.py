"""Shared FastAPI dependencies: authentication, role gates, pagination.

Authorisation lives here and in the service layer — never in the frontend
alone. Every protected endpoint declares the role(s) it accepts.
"""

from __future__ import annotations

from typing import Annotated, Any, Callable

import jwt
from bson import ObjectId
from fastapi import Depends, Query, Request

from app.core.errors import AuthError, PermissionError_
from app.core.security import decode_token
from app.models.enums import AccountStatus, Role
from app.schemas.booking import BookingFilters
from app.schemas.common import PaginationParams
from app.services import driver_service, user_service

#: Upper bound on any page size. Generous enough for reference lists that
#: populate a dropdown in one request (routes, vehicle classes), while still
#: capping how much a single call can pull.
MAX_PAGE_SIZE = 200


def _bearer_token(request: Request) -> str:
    header = request.headers.get("Authorization", "")
    scheme, _, token = header.partition(" ")
    if scheme.lower() != "bearer" or not token.strip():
        raise AuthError("Please sign in to continue.")
    return token.strip()


async def get_current_user(request: Request) -> dict[str, Any]:
    token = _bearer_token(request)
    try:
        payload = decode_token(token, "access")
    except jwt.ExpiredSignatureError:
        raise AuthError("Your session has expired. Please sign in again.")
    except jwt.PyJWTError:
        raise AuthError("Please sign in to continue.")

    try:
        user_id = ObjectId(payload["sub"])
    except Exception:
        raise AuthError("Please sign in to continue.")

    user = await user_service.get_by_id(user_id)
    if not user:
        raise AuthError("Please sign in to continue.")
    if user.get("status") != AccountStatus.ACTIVE.value:
        raise PermissionError_("This account has been suspended. Please contact support.")
    # The role inside the token is advisory; the stored role is authoritative.
    return user


CurrentUser = Annotated[dict, Depends(get_current_user)]


def require_roles(*roles: Role) -> Callable:
    allowed = {role.value for role in roles}

    async def dependency(user: CurrentUser) -> dict[str, Any]:
        if user["role"] not in allowed:
            raise PermissionError_("You do not have access to this area.")
        return user

    return dependency


require_customer = require_roles(Role.CUSTOMER)
require_driver = require_roles(Role.DRIVER)
require_admin = require_roles(Role.ADMIN)
require_staff = require_roles(Role.ADMIN, Role.DRIVER)

CustomerUser = Annotated[dict, Depends(require_customer)]
DriverUser = Annotated[dict, Depends(require_driver)]
AdminUser = Annotated[dict, Depends(require_admin)]


async def get_current_driver(user: DriverUser) -> dict[str, Any]:
    """The driver profile linked to the signed-in driver account."""
    return await driver_service.require_driver_for_user(user["_id"])


CurrentDriver = Annotated[dict, Depends(get_current_driver)]


def pagination(
    page: int = Query(1, ge=1, le=10_000),
    page_size: int = Query(20, ge=1, le=MAX_PAGE_SIZE),
) -> PaginationParams:
    return PaginationParams(page=page, page_size=page_size)


Pagination = Annotated[PaginationParams, Depends(pagination)]


def booking_filters(
    status: str | None = Query(None),
    payment_status: str | None = Query(None),
    driver_id: str | None = Query(None),
    vehicle_id: str | None = Query(None),
    route_id: str | None = Query(None),
    customer_id: str | None = Query(None),
    trip_type: str | None = Query(None),
    date_from: str | None = Query(None),
    date_to: str | None = Query(None),
    search: str | None = Query(None, max_length=80),
) -> dict[str, Any]:
    payload = {
        "status": status,
        "payment_status": payment_status,
        "driver_id": driver_id,
        "vehicle_id": vehicle_id,
        "route_id": route_id,
        "customer_id": customer_id,
        "trip_type": trip_type,
        "date_from": date_from,
        "date_to": date_to,
        "search": search,
    }
    cleaned = {k: v for k, v in payload.items() if v not in (None, "")}
    return BookingFilters(**cleaned).model_dump(exclude_none=True)


BookingFilterParams = Annotated[dict, Depends(booking_filters)]
