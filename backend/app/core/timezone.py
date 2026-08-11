"""Business timezone helpers.

Timestamps are stored in UTC, which is correct. But business rules are not
UTC rules: "a 9 AM pickup", "today's earnings" and "the night surcharge
window" all mean local wall-clock time to an Indian operator. Anything that
turns an instant into a *business* day or hour must go through here.
"""

from __future__ import annotations

import datetime as dt
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

DEFAULT_TIMEZONE = "Asia/Kolkata"


def get_zone(name: str | None = None) -> ZoneInfo:
    try:
        return ZoneInfo(name or DEFAULT_TIMEZONE)
    except (ZoneInfoNotFoundError, ValueError):
        return ZoneInfo(DEFAULT_TIMEZONE)


def to_local(value: dt.datetime, tz_name: str | None = None) -> dt.datetime:
    """Interpret a stored timestamp in the business timezone."""
    aware = value if value.tzinfo else value.replace(tzinfo=dt.timezone.utc)
    return aware.astimezone(get_zone(tz_name))


def local_hour(value: dt.datetime, tz_name: str | None = None) -> int:
    return to_local(value, tz_name).hour


def start_of_local_day(value: dt.datetime | None = None, tz_name: str | None = None) -> dt.datetime:
    """Midnight of the business day containing `value`, returned in UTC."""
    zone = get_zone(tz_name)
    moment = value or dt.datetime.now(dt.timezone.utc)
    aware = moment if moment.tzinfo else moment.replace(tzinfo=dt.timezone.utc)
    local_midnight = aware.astimezone(zone).replace(hour=0, minute=0, second=0, microsecond=0)
    return local_midnight.astimezone(dt.timezone.utc)


def local_date(value: dt.datetime, tz_name: str | None = None) -> dt.date:
    return to_local(value, tz_name).date()
