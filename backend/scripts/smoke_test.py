"""End-to-end smoke test against a running API.

    python -m scripts.smoke_test [--base-url http://127.0.0.1:8000]

Exercises the real HTTP surface: authentication for all three roles,
role-based authorisation, the full booking workflow, pricing integrity and
input validation. Exits non-zero on the first failure.
"""

from __future__ import annotations

import argparse
import datetime as dt
import random
import sys
import uuid

import httpx

PASS, FAIL = "  ✓", "  ✗"
failures: list[str] = []
checks = 0


def check(name: str, condition: bool, detail: str = "") -> None:
    global checks
    checks += 1
    if condition:
        print(f"{PASS} {name}")
    else:
        print(f"{FAIL} {name} — {detail}")
        failures.append(name)


class Client:
    def __init__(self, base_url: str):
        self.http = httpx.Client(base_url=base_url, timeout=30.0)
        self.token: str | None = None

    def request(self, method: str, path: str, **kwargs) -> httpx.Response:
        headers = kwargs.pop("headers", {})
        if self.token:
            headers["Authorization"] = f"Bearer {self.token}"
        return self.http.request(method, path, headers=headers, **kwargs)

    def get(self, path, **kw):
        return self.request("GET", path, **kw)

    def post(self, path, **kw):
        return self.request("POST", path, **kw)

    def patch(self, path, **kw):
        return self.request("PATCH", path, **kw)

    def put(self, path, **kw):
        return self.request("PUT", path, **kw)

    def delete(self, path, **kw):
        return self.request("DELETE", path, **kw)

    def login(self, email: str, password: str) -> httpx.Response:
        response = self.post("/api/auth/login", json={"email": email, "password": password})
        if response.status_code == 200:
            self.token = response.json()["access_token"]
        return response


def main(base_url: str) -> int:
    admin, driver, customer, anon = (Client(base_url) for _ in range(4))

    print("\n[1] Health")
    health = anon.get("/api/health").json()
    check("health reports database ok", health.get("database") == "ok", str(health))

    print("\n[2] Authentication")
    check("admin login", admin.login("admin@localride.in", "Admin@12345").status_code == 200)
    check(
        "driver login",
        driver.login("sandeep.kulkarni@localride.in", "Password@123").status_code == 200,
    )
    check(
        "customer login",
        customer.login("aarti.joshi@example.com", "Password@123").status_code == 200,
    )
    bad = anon.post(
        "/api/auth/login",
        json={"email": "aarti.joshi@example.com", "password": "wrong-password"},
    )
    check("wrong password rejected", bad.status_code == 401, str(bad.status_code))
    unknown = anon.post(
        "/api/auth/login", json={"email": "nobody@example.com", "password": "whatever1!"}
    )
    check(
        "unknown account gives the same generic error",
        unknown.status_code == 401 and unknown.json()["detail"] == bad.json()["detail"],
    )

    print("\n[3] Registration and validation")
    unique = uuid.uuid4().hex[:8]
    rng = random.Random()
    demo_phone = lambda: f"9{rng.randint(100000000, 999999999)}"
    weak = anon.post(
        "/api/auth/register",
        json={
            "name": "Test User",
            "email": f"weak{unique}@example.com",
            "phone": demo_phone(),
            "password": "12345678",
        },
    )
    check("all-numeric password rejected", weak.status_code == 422, str(weak.status_code))
    bad_phone = anon.post(
        "/api/auth/register",
        json={
            "name": "Test User",
            "email": f"badphone{unique}@example.com",
            "phone": "12345",
            "password": "Str0ng@pass",
        },
    )
    check("invalid phone rejected", bad_phone.status_code == 422, str(bad_phone.status_code))

    new_customer = Client(base_url)
    registered = new_customer.post(
        "/api/auth/register",
        json={
            "name": "Smoke Test Customer",
            "email": f"smoke{unique}@example.com",
            "phone": demo_phone(),
            "password": "Str0ng@pass",
        },
    )
    check("registration succeeds", registered.status_code == 201, registered.text[:200])
    if registered.status_code == 201:
        new_customer.token = registered.json()["access_token"]
        check(
            "registration returns a customer role",
            registered.json()["user"]["role"] == "customer",
        )
        check(
            "password hash never leaves the API",
            "password" not in registered.text and "hash" not in registered.text,
        )

    duplicate = anon.post(
        "/api/auth/register",
        json={
            "name": "Duplicate",
            "email": "aarti.joshi@example.com",
            "phone": demo_phone(),
            "password": "Str0ng@pass",
        },
    )
    check("duplicate email rejected", duplicate.status_code == 409, str(duplicate.status_code))

    print("\n[4] Unauthenticated and cross-role access")
    check("no token → 401 on /users/me", anon.get("/api/users/me").status_code == 401)
    check("no token → 401 on /bookings", anon.get("/api/bookings").status_code == 401)
    check(
        "garbage token → 401",
        Client(base_url).http.get(
            "/api/users/me", headers={"Authorization": "Bearer not-a-jwt"}
        ).status_code
        == 401,
    )
    check("customer blocked from admin dashboard", customer.get("/api/admin/dashboard").status_code == 403)
    check("customer blocked from driver list", customer.get("/api/drivers").status_code == 403)
    check("customer blocked from vehicles", customer.get("/api/vehicles").status_code == 403)
    check("customer blocked from price book", customer.get("/api/pricing").status_code == 403)
    check("customer blocked from reports", customer.get("/api/admin/reports").status_code == 403)
    check("driver blocked from admin dashboard", driver.get("/api/admin/dashboard").status_code == 403)
    check("driver blocked from customer directory", driver.get("/api/admin/customers").status_code == 403)
    check("driver blocked from vehicles", driver.get("/api/vehicles").status_code == 403)
    check("admin cannot use driver-only endpoint", admin.get("/api/drivers/me").status_code == 403)
    check(
        "customer cannot create a coupon",
        customer.post(
            "/api/coupons", json={"code": "HACK", "discount_type": "flat", "discount_value": 100}
        ).status_code
        == 403,
    )

    print("\n[5] Route catalogue and pricing")
    routes = admin.get("/api/routes", params={"page_size": 100}).json()
    check("routes seeded", routes["total"] >= 15, str(routes["total"]))
    pune_mumbai = next(
        (r for r in routes["items"] if r["origin"] == "Pune" and r["destination"] == "Mumbai"),
        None,
    )
    check("Pune → Mumbai route exists", pune_mumbai is not None)

    quote = customer.post(
        "/api/pricing/quote",
        json={"pickup": "Pune", "drop": "Mumbai", "trip_type": "one_way"},
    )
    check("customer can fetch a quote", quote.status_code == 200, quote.text[:200])
    options = {o["vehicle_type"]: o for o in quote.json()["options"]} if quote.status_code == 200 else {}
    check("sedan quoted at ₹3,000", options.get("sedan", {}).get("fare") == 3000, str(options.get("sedan")))
    check("suv quoted at ₹4,000", options.get("suv", {}).get("fare") == 4000, str(options.get("suv")))
    check("premium quoted at ₹4,500", options.get("premium", {}).get("fare") == 4500, str(options.get("premium")))
    check(
        "seating capacity present on options",
        options.get("sedan", {}).get("seating_capacity") == 4
        and options.get("suv", {}).get("seating_capacity") == 6,
    )

    round_trip = customer.post(
        "/api/pricing/quote",
        json={"pickup": "Pune", "drop": "Mumbai", "trip_type": "round_trip"},
    ).json()
    rt_sedan = next(o for o in round_trip["options"] if o["vehicle_type"] == "sedan")
    check("round trip costs more than one way", rt_sedan["fare"] > 3000, str(rt_sedan["fare"]))

    unknown_route = customer.post(
        "/api/pricing/quote", json={"pickup": "Atlantis", "drop": "Narnia", "trip_type": "one_way"}
    )
    check("unknown route returns 404", unknown_route.status_code == 404)
    check(
        "quote without route or places rejected",
        customer.post("/api/pricing/quote", json={"trip_type": "one_way"}).status_code == 422,
    )

    # Night surcharge must follow the operator's local clock, not UTC.
    # 03:30Z is 09:00 IST (a day trip); 17:30Z is 23:00 IST (a night trip).
    day_quote = customer.post(
        "/api/pricing/quote",
        json={
            "pickup": "Pune",
            "drop": "Mumbai",
            "trip_type": "one_way",
            "vehicle_type": "sedan",
            "scheduled_at": "2026-08-02T03:30:00Z",
        },
    ).json()["options"][0]
    night_quote = customer.post(
        "/api/pricing/quote",
        json={
            "pickup": "Pune",
            "drop": "Mumbai",
            "trip_type": "one_way",
            "vehicle_type": "sedan",
            "scheduled_at": "2026-08-02T17:30:00Z",
        },
    ).json()["options"][0]
    check(
        "9am local pickup carries no night surcharge",
        day_quote["breakdown"]["night_surcharge"] == 0 and day_quote["fare"] == 3000,
        str(day_quote["fare"]),
    )
    check(
        "11pm local pickup does carry a night surcharge",
        night_quote["breakdown"]["night_surcharge"] > 0
        and night_quote["fare"] > day_quote["fare"],
        str(night_quote["fare"]),
    )

    coupon_quote = customer.post(
        "/api/pricing/quote",
        json={
            "pickup": "Pune",
            "drop": "Mumbai",
            "trip_type": "one_way",
            "coupon_code": "PUNEMUM300",
        },
    ).json()
    discounted = next(o for o in coupon_quote["options"] if o["vehicle_type"] == "sedan")
    check("coupon reduces fare by ₹300", discounted["fare"] == 2700, str(discounted["fare"]))

    print("\n[6] Booking creation (server-side pricing)")
    # Randomised slot so repeat runs do not collide with the driver
    # double-booking guard (which is itself asserted below).
    scheduled = (
        dt.datetime.now(dt.timezone.utc) + dt.timedelta(days=rng.randint(5, 60))
    ).replace(hour=rng.randrange(6, 22), minute=0, second=0, microsecond=0)
    booking_payload = {
        "route_id": pune_mumbai["id"],
        "pickup": {"address": "Baner Road, Pune"},
        "drop": {"address": "Bandra Kurla Complex, Mumbai"},
        "trip_type": "one_way",
        "vehicle_type": "sedan",
        "scheduled_at": scheduled.isoformat(),
        "passenger_count": 2,
        "passenger_name": "Aarti Joshi",
        "passenger_phone": "9860022001",
        "notes": "Smoke test booking",
        "payment_method": "cash",
    }
    created = customer.post("/api/bookings", json=booking_payload)
    check("booking created", created.status_code == 201, created.text[:300])
    if created.status_code != 201:
        return report()
    booking = created.json()
    booking_oid = booking["id"]
    check("booking reference generated", booking["booking_id"].startswith("LR-"), booking["booking_id"])
    check("fare taken from the price book", booking["total_fare"] == 3000, str(booking["total_fare"]))
    check("initial status is requested", booking["status"] == "requested")
    check("status history seeded", len(booking.get("history", [])) == 1)

    tampered = dict(booking_payload)
    tampered.update({"total_fare": 1, "fare": 1, "price": 1})
    tamper_response = customer.post("/api/bookings", json=tampered)
    check(
        "client-supplied price is rejected outright",
        tamper_response.status_code == 422,
        f"got {tamper_response.status_code}",
    )

    seat_overflow = dict(booking_payload)
    seat_overflow["passenger_count"] = 6
    check(
        "passenger count validated against vehicle class",
        customer.post("/api/bookings", json=seat_overflow).status_code == 422,
    )

    past = dict(booking_payload)
    past["scheduled_at"] = (dt.datetime.now(dt.timezone.utc) - dt.timedelta(days=1)).isoformat()
    check("past pickup time rejected", customer.post("/api/bookings", json=past).status_code == 422)

    print("\n[7] Booking visibility")
    other_customer = Client(base_url)
    other_customer.login("rohit.sharma@example.com", "Password@123")
    check(
        "another customer cannot read this booking",
        other_customer.get(f"/api/bookings/{booking_oid}").status_code == 404,
    )
    check(
        "unassigned driver cannot read this booking",
        driver.get(f"/api/bookings/{booking_oid}").status_code == 404,
    )
    check("admin can read any booking", admin.get(f"/api/bookings/{booking_oid}").status_code == 200)
    mine = customer.get("/api/bookings", params={"page_size": 100}).json()
    check(
        "customer list is scoped to their own bookings",
        all(b["customer"]["id"] == booking["customer"]["id"] for b in mine["items"]),
    )

    print("\n[8] Booking workflow")
    check(
        "cannot skip straight to completed",
        admin.post(
            f"/api/bookings/{booking_oid}/status", json={"status": "completed"}
        ).status_code
        == 409,
    )
    confirmed = admin.post(f"/api/bookings/{booking_oid}/status", json={"status": "confirmed"})
    check("admin confirms booking", confirmed.status_code == 200, confirmed.text[:200])

    assignable = admin.get("/api/drivers/assignable").json()
    check("assignable drivers available", len(assignable) > 0)
    target_driver = next(
        (d for d in assignable if d["user"]["email"] == "sandeep.kulkarni@localride.in"),
        assignable[0] if assignable else None,
    )
    assigned = admin.post(
        f"/api/bookings/{booking_oid}/assign-driver", json={"driver_id": target_driver["id"]}
    )
    check("admin assigns driver", assigned.status_code == 200, assigned.text[:300])
    check("status became driver_assigned", assigned.json()["status"] == "driver_assigned")
    check("driver details attached", assigned.json()["driver"]["name"] is not None)

    clash_booking = customer.post(
        "/api/bookings", json={**booking_payload, "notes": "clash probe"}
    ).json()
    admin.post(f"/api/bookings/{clash_booking['id']}/status", json={"status": "confirmed"})
    clash = admin.post(
        f"/api/bookings/{clash_booking['id']}/assign-driver",
        json={"driver_id": target_driver["id"]},
    )
    check("double-booking the same driver is refused", clash.status_code == 409, str(clash.status_code))
    admin.post(f"/api/bookings/{clash_booking['id']}/cancel", json={"reason": "Smoke test cleanup"})

    assigned_driver = Client(base_url)
    assigned_driver.login(target_driver["user"]["email"], "Password@123")
    check(
        "assigned driver can now read the booking",
        assigned_driver.get(f"/api/bookings/{booking_oid}").status_code == 200,
    )
    check(
        "driver cannot assign a driver",
        assigned_driver.post(
            f"/api/bookings/{booking_oid}/assign-driver", json={"driver_id": target_driver["id"]}
        ).status_code
        == 403,
    )
    check(
        "driver cannot override the fare",
        assigned_driver.post(
            f"/api/bookings/{booking_oid}/fare", json={"total_fare": 1, "reason": "nope"}
        ).status_code
        == 403,
    )
    check(
        "driver cannot cancel",
        assigned_driver.post(
            f"/api/bookings/{booking_oid}/cancel", json={"reason": "changed my mind"}
        ).status_code
        == 403,
    )
    check(
        "customer cannot drive the status machine",
        customer.post(f"/api/bookings/{booking_oid}/status", json={"status": "completed"}).status_code
        == 403,
    )

    for status_value in ["accepted", "driver_arriving", "picked_up", "trip_started", "completed"]:
        response = assigned_driver.post(
            f"/api/bookings/{booking_oid}/status", json={"status": status_value}
        )
        check(f"driver sets {status_value}", response.status_code == 200, response.text[:200])

    final = admin.get(f"/api/bookings/{booking_oid}").json()
    check("booking completed", final["status"] == "completed")
    check("completed_at recorded", final.get("completed_at") is not None)
    history_states = [h["to_status"] for h in final["history"]]
    check(
        "full timeline recorded",
        history_states
        == [
            "requested",
            "confirmed",
            "driver_assigned",
            "accepted",
            "driver_arriving",
            "picked_up",
            "trip_started",
            "completed",
        ],
        str(history_states),
    )
    check(
        "completed booking cannot be reopened",
        admin.post(f"/api/bookings/{booking_oid}/status", json={"status": "trip_started"}).status_code
        == 409,
    )

    print("\n[9] Payments and reviews")
    payment = admin.post(
        f"/api/bookings/{booking_oid}/payments",
        json={"amount": 3000, "method": "cash", "status": "paid"},
    )
    check("payment recorded", payment.status_code == 200, payment.text[:200])
    check("payment status flipped to paid", payment.json()["payment_status"] == "paid")

    review = customer.post(
        "/api/reviews", json={"booking_id": booking_oid, "rating": 5, "comment": "Great trip."}
    )
    check("customer reviews completed trip", review.status_code == 201, review.text[:200])
    check(
        "duplicate review rejected",
        customer.post(
            "/api/reviews", json={"booking_id": booking_oid, "rating": 1, "comment": "again"}
        ).status_code
        == 409,
    )
    check(
        "another customer cannot review this trip",
        other_customer.post(
            "/api/reviews", json={"booking_id": booking_oid, "rating": 1}
        ).status_code
        == 403,
    )
    check(
        "rating out of range rejected",
        customer.post("/api/reviews", json={"booking_id": booking_oid, "rating": 9}).status_code
        == 422,
    )

    print("\n[10] Cancellation rules")
    cancel_target = customer.post(
        "/api/bookings",
        json={**booking_payload, "notes": "to be cancelled"},
    )
    check("second booking created", cancel_target.status_code == 201, cancel_target.text[:200])
    cancel_id = cancel_target.json()["id"]
    cancelled = customer.post(
        f"/api/bookings/{cancel_id}/cancel", json={"reason": "Plans changed"}
    )
    check("customer cancels their own booking", cancelled.status_code == 200, cancelled.text[:200])
    check("status is cancelled", cancelled.json()["status"] == "cancelled")
    check(
        "cancelling twice is rejected",
        customer.post(f"/api/bookings/{cancel_id}/cancel", json={"reason": "again"}).status_code
        == 409,
    )
    check(
        "customer cannot cancel someone else's booking",
        other_customer.post(
            f"/api/bookings/{booking_oid}/cancel", json={"reason": "not mine"}
        ).status_code
        in (403, 404, 409),
    )

    print("\n[11] Driver workspace")
    dashboard = assigned_driver.get("/api/drivers/me/dashboard")
    check("driver dashboard loads", dashboard.status_code == 200, dashboard.text[:200])
    body = dashboard.json()
    check("dashboard exposes earnings", "earnings" in body and "today" in body["earnings"])
    check("dashboard exposes driver profile", body["driver"]["name"] is not None)
    earnings = assigned_driver.get("/api/drivers/me/earnings").json()
    check("lifetime earnings are positive", earnings["lifetime"]["earnings"] > 0, str(earnings["lifetime"]))
    check("earnings include a 7-day series", len(earnings["daily"]) == 7)
    offline = assigned_driver.post("/api/drivers/me/availability", json={"is_available": False})
    check("driver can go offline", offline.status_code == 200 and offline.json()["is_available"] is False)
    online = assigned_driver.post("/api/drivers/me/availability", json={"is_available": True})
    check("driver can go online", online.status_code == 200 and online.json()["is_available"] is True)
    docs = assigned_driver.get("/api/drivers/me/documents").json()
    check("driver documents listed", len(docs["documents"]) >= 2)

    unverified = Client(base_url)
    unverified.login("prakash.more@localride.in", "Password@123")
    check(
        "unverified driver cannot go online",
        unverified.post("/api/drivers/me/availability", json={"is_available": True}).status_code
        == 422,
    )

    print("\n[12] Admin management")
    dash = admin.get("/api/admin/dashboard")
    check("admin dashboard loads", dash.status_code == 200, dash.text[:200])
    cards = dash.json()["cards"]
    check("dashboard cards populated", cards["todays_bookings"] >= 0 and cards["active_drivers"] > 0)
    check("revenue trend has 14 points", len(dash.json()["revenue_trend"]) == 14)

    reports = admin.get("/api/admin/reports").json()
    check("reports summary present", "summary" in reports and reports["summary"]["total_bookings"] > 0)
    check("driver performance rows", len(reports["drivers"]) > 0)
    check("route performance rows", len(reports["routes"]) > 0)

    customers_page = admin.get("/api/admin/customers").json()
    check("customer directory loads", customers_page["total"] >= 6)
    check("customer stats attached", "stats" in customers_page["items"][0])

    reg = f"MH12ZZ{uuid.uuid4().hex[:4].upper()}"
    vehicle = admin.post(
        "/api/vehicles",
        json={
            "vehicle_type": "sedan",
            "model": "Tata Tigor",
            "registration_number": reg,
            "seating_capacity": 4,
            "is_ac": True,
        },
    )
    check("admin adds a vehicle", vehicle.status_code == 201, vehicle.text[:200])
    vehicle_id = vehicle.json()["id"]
    check(
        "duplicate registration rejected",
        admin.post(
            "/api/vehicles",
            json={
                "vehicle_type": "sedan",
                "model": "Another",
                "registration_number": reg,
                "seating_capacity": 4,
            },
        ).status_code
        == 409,
    )
    check(
        "vehicle updated",
        admin.patch(f"/api/vehicles/{vehicle_id}", json={"status": "maintenance"}).json()["status"]
        == "maintenance",
    )
    check("vehicle deleted", admin.delete(f"/api/vehicles/{vehicle_id}").status_code == 200)

    new_route = admin.post(
        "/api/routes",
        json={
            "origin": f"Testpur{unique}",
            "destination": f"Demogaon{unique}",
            "distance_km": 100,
            "duration_minutes": 150,
        },
    )
    check("admin creates a route", new_route.status_code == 201, new_route.text[:200])
    route_id = new_route.json()["id"]
    priced = admin.put(
        "/api/pricing",
        json={"route_id": route_id, "vehicle_type": "sedan", "fixed_fare": 2500},
    )
    check("admin publishes a price", priced.status_code == 200, priced.text[:200])
    new_quote = customer.post(
        "/api/pricing/quote", json={"route_id": route_id, "trip_type": "one_way"}
    ).json()
    check(
        "new price is served to customers",
        new_quote["options"][0]["fare"] == 2500,
        str(new_quote["options"][0]["fare"]),
    )
    updated_price = admin.patch(
        f"/api/pricing/{priced.json()['id']}", json={"fixed_fare": 2750}
    )
    check("admin edits a price", updated_price.json()["fixed_fare"] == 2750)
    requoted = customer.post(
        "/api/pricing/quote", json={"route_id": route_id, "trip_type": "one_way"}
    ).json()
    check("edited price is reflected immediately", requoted["options"][0]["fare"] == 2750)
    admin.delete(f"/api/pricing/{priced.json()['id']}")
    check("route deleted", admin.delete(f"/api/routes/{route_id}").status_code == 200)

    print("\n[13] Fare override, coupons, notifications, settings")
    override_target = customer.post("/api/bookings", json=booking_payload).json()
    override = admin.post(
        f"/api/bookings/{override_target['id']}/fare",
        json={"total_fare": 3200, "reason": "Extra waiting time at pickup"},
    )
    check("admin overrides fare", override.status_code == 200 and override.json()["total_fare"] == 3200)
    check("override is flagged", override.json()["fare_overridden"] is True)
    check(
        "negative fare override rejected",
        admin.post(
            f"/api/bookings/{override_target['id']}/fare",
            json={"total_fare": -50, "reason": "invalid"},
        ).status_code
        == 422,
    )

    code = f"SMOKE{unique[:5].upper()}"
    coupon = admin.post(
        "/api/coupons",
        json={
            "code": code,
            "discount_type": "percent",
            "discount_value": 10,
            "min_booking_value": 500,
            "max_discount": 200,
        },
    )
    check("admin creates a coupon", coupon.status_code == 201, coupon.text[:200])
    check(
        "customer can validate the coupon",
        customer.get(f"/api/coupons/validate/{code}").status_code == 200,
    )
    check(
        "invalid coupon rejected",
        customer.get("/api/coupons/validate/NOTREAL").status_code == 422,
    )
    check(
        "percent over 100 rejected",
        admin.post(
            "/api/coupons",
            json={"code": f"BAD{unique[:4]}", "discount_type": "percent", "discount_value": 150},
        ).status_code
        == 422,
    )
    admin.delete(f"/api/coupons/{coupon.json()['id']}")

    notifications = customer.get("/api/notifications").json()
    check("customer has notifications", notifications["total"] > 0)
    unread = customer.get("/api/notifications/unread-count").json()
    check("unread count returned", "count" in unread)
    check("only in-app delivery is claimed", unread["channels"] == ["in_app"], str(unread["channels"]))

    settings_response = admin.get("/api/admin/settings")
    check("admin reads settings", settings_response.status_code == 200)
    patched = admin.patch(
        "/api/admin/settings",
        json={"pricing": {**settings_response.json()["pricing"], "round_trip_multiplier": 1.9}},
    )
    check("admin updates settings", patched.status_code == 200)
    rt_after = next(
        o
        for o in customer.post(
            "/api/pricing/quote",
            json={"pickup": "Pune", "drop": "Mumbai", "trip_type": "round_trip"},
        ).json()["options"]
        if o["vehicle_type"] == "sedan"
    )
    check("settings change flows into pricing", rt_after["fare"] == 5700, str(rt_after["fare"]))
    admin.patch(
        "/api/admin/settings",
        json={"pricing": {**settings_response.json()["pricing"], "round_trip_multiplier": 1.85}},
    )

    print("\n[14] Support and misc")
    support = customer.post(
        "/api/support/requests",
        json={"subject": "Invoice needed", "message": "Please email me the invoice for my last trip."},
    )
    check("support message accepted", support.status_code == 201, support.text[:200])
    check("customer blocked from admin support inbox", customer.get("/api/support/admin/requests").status_code == 403)
    check("admin reads support inbox", admin.get("/api/support/admin/requests").status_code == 200)
    caps = customer.get("/api/routes/map-capabilities").json()
    check("map capabilities do not leak a key", "key" not in str(caps).lower(), str(caps))
    check("live tracking honestly reported as off", caps["live_tracking"] is False)
    check(
        "bad object id returns 422 not 500",
        customer.get("/api/bookings/not-an-id").status_code == 422,
    )
    check(
        "unknown booking returns 404",
        admin.get("/api/bookings/000000000000000000000000").status_code == 404,
    )

    print("\n[15] Account suspension")
    suspend_target = customers_page["items"][-1]
    admin.post(f"/api/admin/customers/{suspend_target['id']}/suspend", json={"suspended": True})
    suspended_client = Client(base_url)
    suspended_login = suspended_client.post(
        "/api/auth/login", json={"email": suspend_target["email"], "password": "Password@123"}
    )
    check("suspended account cannot sign in", suspended_login.status_code == 403, str(suspended_login.status_code))
    admin.post(f"/api/admin/customers/{suspend_target['id']}/suspend", json={"suspended": False})
    check(
        "restored account can sign in again",
        Client(base_url).login(suspend_target["email"], "Password@123").status_code == 200,
    )

    # Runs last: it deliberately exhausts the login rate-limit window.
    print("\n[16] Rate limiting")
    hammer = Client(base_url)
    codes = [
        hammer.post(
            "/api/auth/login", json={"email": "nobody@example.com", "password": "Wrong@123"}
        ).status_code
        for _ in range(80)
    ]
    check(
        "repeated login attempts are throttled",
        429 in codes,
        f"never throttled across {len(codes)} attempts",
    )

    return report()


def report() -> int:
    print(f"\n{'=' * 60}")
    if failures:
        print(f"FAILED — {len(failures)} of {checks} checks did not pass:")
        for name in failures:
            print(f"  · {name}")
        return 1
    print(f"PASSED — all {checks} checks succeeded.")
    return 0


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--base-url", default="http://127.0.0.1:8000")
    args = parser.parse_args()
    sys.exit(main(args.base_url))
