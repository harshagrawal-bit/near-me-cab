"""Location/maps abstraction.

Today this resolves places against the route catalogue — no external calls, no
API key required. When Google Maps (Places / Distance Matrix) is enabled, add
a `GoogleMapsProvider` implementing `LocationProvider` and select it in
`get_provider()`. Callers never change.

The API key lives in `GOOGLE_MAPS_API_KEY` and is only ever read server-side;
the frontend receives a capability flag, never the key itself.
"""

from __future__ import annotations

from typing import Any, Protocol

from app.core.config import settings
from app.db import mongodb
from app.services import route_service


class LocationProvider(Protocol):
    name: str

    def is_configured(self) -> bool: ...

    async def suggest(self, query: str, limit: int) -> list[dict[str, Any]]: ...

    async def distance(self, origin: str, destination: str) -> dict[str, Any] | None: ...


class CatalogueProvider:
    """Suggestions drawn from the routes the business actually operates."""

    name = "catalogue"

    def is_configured(self) -> bool:
        return True

    async def suggest(self, query: str, limit: int = 8) -> list[dict[str, Any]]:
        places: dict[str, dict[str, Any]] = {}
        for route in await route_service.search_routes(query, limit=limit * 3):
            for field in ("origin", "destination"):
                value = route[field]
                if query and query.lower() not in value.lower():
                    continue
                places.setdefault(
                    route_service.place_key(value),
                    {"description": value, "place_id": None, "source": self.name},
                )
        return list(places.values())[:limit]

    async def distance(self, origin: str, destination: str) -> dict[str, Any] | None:
        route = await route_service.find_by_places(origin, destination)
        if not route:
            return None
        return {
            "distance_km": route["distance_km"],
            "duration_minutes": route["duration_minutes"],
            "source": self.name,
        }


_catalogue = CatalogueProvider()


def get_provider() -> LocationProvider:
    # When a Google Maps provider is added, prefer it here if configured.
    return _catalogue


def capabilities() -> dict[str, Any]:
    """What the frontend is allowed to know about mapping support."""
    return {
        "provider": get_provider().name,
        "places_autocomplete": True,
        "google_maps_enabled": bool(settings.GOOGLE_MAPS_API_KEY),
        "live_tracking": False,
    }


async def suggest_places(query: str, limit: int = 8) -> list[dict[str, Any]]:
    provider = get_provider()
    results = await provider.suggest(query, limit)
    if results:
        return results
    # Fall back to distinct saved locations so a customer's own addresses
    # remain searchable even for places outside the route catalogue.
    matches = await mongodb.users().distinct(
        "saved_locations.address", {"saved_locations.address": {"$regex": query, "$options": "i"}}
    )
    return [{"description": m, "place_id": None, "source": "saved"} for m in matches[:limit]]


async def estimate_distance(origin: str, destination: str) -> dict[str, Any] | None:
    return await get_provider().distance(origin, destination)
