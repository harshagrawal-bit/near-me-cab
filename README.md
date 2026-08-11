# LocalRide

A cab and local-travel booking platform for a regional Indian travel business.
Customers book outstation, airport and local trips; drivers run their trips from
a phone; the operations team confirms bookings, assigns drivers and manages
pricing from a desktop console.

**Stack:** React 18 + Vite + Tailwind · FastAPI + Motor · MongoDB · REST + JWT

> **`LocalRide` is a placeholder brand.** It lives in one file
> ([`frontend/src/config/brand.js`](frontend/src/config/brand.js)) plus the
> `VITE_BRAND_*` environment variables. Change it there and the whole app
> follows — no component hard-codes the name.

---

## Contents

- [Quick start](#quick-start)
- [Architecture](#architecture)
- [Database collections](#database-collections)
- [Authentication flow](#authentication-flow)
- [Booking flow](#booking-flow)
- [Pricing flow](#pricing-flow)
- [Permissions](#permissions)
- [Environment variables](#environment-variables)
- [Running tests](#running-tests)
- [Deployment](#deployment)
- [What to build next](#what-to-build-next)

---

## Quick start

Requires **Node 18+**, **Python 3.11+** and a **MongoDB 6+** instance.

### Option A — Docker (everything at once)

```bash
cp backend/.env.example backend/.env      # then edit JWT_SECRET
docker compose up --build
docker compose exec api python -m scripts.seed --reset
```

App at <http://localhost:5173>, API at <http://localhost:8000>.

### Option B — Run locally

**1. MongoDB.** Any local or Atlas instance. If you have neither installed, you
can run one in userspace without root:

```bash
mkdir -p ~/.local/mongodb && cd ~/.local/mongodb
curl -sL https://fastdl.mongodb.org/linux/mongodb-linux-x86_64-ubuntu2404-8.0.4.tgz \
  | tar xz --strip-components=1
mkdir -p data log
./bin/mongod --dbpath ./data --logpath ./log/mongod.log --port 27017 --fork
```

**2. Backend.**

```bash
cd backend
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt

cp .env.example .env
# Generate a real secret and paste it into .env as JWT_SECRET:
python -c "import secrets; print(secrets.token_urlsafe(48))"

python -m scripts.seed --reset      # demo data
uvicorn app.main:app --reload --port 8000
```

API docs (development only): <http://localhost:8000/docs>

**3. Frontend.**

```bash
cd frontend
npm install
cp .env.example .env
npm run dev
```

Open <http://localhost:5173>. Vite proxies `/api` to the backend, so the browser
stays same-origin and the httpOnly refresh cookie works without CORS setup.

### Demo accounts

Created by `scripts/seed.py`. **Development only** — change or remove before any
real deployment.

| Role     | Email                            | Password       |
| -------- | -------------------------------- | -------------- |
| Admin    | `admin@localride.in`             | `Admin@12345`  |
| Driver   | `sandeep.kulkarni@localride.in`  | `Password@123` |
| Customer | `aarti.joshi@example.com`        | `Password@123` |

Other seeded drivers and customers share `Password@123`. One driver is left
unverified and one document is expired on purpose, so the admin verification
queue and document-expiry badges are not empty.

---

## Architecture

```
travel app/
├── backend/
│   ├── app/
│   │   ├── main.py              # app factory, middleware, lifespan
│   │   ├── core/                # config, security, errors, rate limiting, timezone
│   │   ├── db/                  # Mongo client + index definitions
│   │   ├── models/enums.py      # domain vocabulary + booking state machine
│   │   ├── schemas/             # Pydantic request/response contracts
│   │   ├── services/            # ALL business logic
│   │   └── api/
│   │       ├── deps.py          # auth, role gates, pagination, filters
│   │       ├── router.py        # aggregates every router
│   │       └── routers/         # one module per resource
│   ├── scripts/seed.py          # demo data
│   ├── scripts/smoke_test.py    # end-to-end HTTP test (132 checks)
│   └── tests/                   # pytest suite (63 tests)
└── frontend/
    └── src/
        ├── config/brand.js      # ← single source of brand identity
        ├── services/            # apiClient + one function per endpoint
        ├── auth/                # AuthContext + ProtectedRoute
        ├── components/ui/       # design system (Button, Field, Modal, DataTable…)
        ├── components/booking/  # StatusTimeline, FareSummary, BookingCard
        ├── layouts/             # Customer / Driver / Admin shells
        ├── pages/               # customer/ driver/ admin/ auth/
        ├── hooks/useApi.js      # loading / error / retry / pagination
        └── lib/                 # formatting (INR, dates), constants
```

### Backend structure

Route handlers stay thin: they validate input, call a service and return the
result. Everything that decides *what happens* lives in `app/services/`, so the
same logic is reachable from a future worker, CLI or scheduled job.

| Service | Responsibility |
| --- | --- |
| `auth_service` | register, login, refresh |
| `user_service` | user records shared by all roles |
| `driver_service` | verification, availability, vehicle binding, earnings |
| `vehicle_service` | fleet and availability counts |
| `route_service` | route catalogue |
| `pricing_service` | **the fare engine** |
| `booking_service` | booking lifecycle + status machine |
| `coupon_service` | discount arithmetic |
| `review_service` | ratings and moderation |
| `report_service` | dashboard metrics and reports |
| `notification_service` | channel abstraction |
| `maps_service` | location provider abstraction |
| `settings_service` | global admin settings |

### Frontend structure

Three role shells (`CustomerLayout`, `DriverLayout`, `AdminLayout`) over one
design system. Customer and driver are mobile-first with a bottom tab bar; admin
is desktop-first with a sidebar that collapses to a drawer on tablet.

Route components are lazy-loaded, so a customer never downloads the admin panel.

---

## Database collections

| Collection | Purpose | Key indexes |
| --- | --- | --- |
| `users` | all three roles, with `password_hash` | unique `email`, unique `phone`, text search |
| `drivers` | driver profile, licence, documents, rating | unique `user_id`, availability, verification |
| `vehicles` | fleet | unique `registration_number`, type+status |
| `routes` | origin/destination pairs | unique `(origin_key, destination_key)` |
| `pricing` | fare per route + vehicle class | unique `(route_id, vehicle_type)` |
| `bookings` | the core record | unique `booking_id`, customer/driver/status/date |
| `booking_status_history` | every transition, who made it, when | `(booking_id, created_at)` |
| `payments` | payment ledger, provider-agnostic | `booking_id`, status |
| `coupons` | offers | unique `code` |
| `reviews` | one per completed booking | unique `booking_id` |
| `notifications` | in-app inbox | `(user_id, created_at)`, unread |
| `admin_settings` | one document: company, pricing, booking rules | unique `key` |
| `support_requests` | contact messages (deliberately not a ticketing system) | — |
| `counters` | daily sequence for booking references | — |

Indexes are applied idempotently on startup (`app/db/indexes.py`). All records
carry `created_at` / `updated_at`.

---

## Authentication flow

1. `POST /api/auth/login` verifies the bcrypt hash and returns a short-lived
   **access token** (JSON body) plus a **refresh token** in an `httpOnly`,
   `SameSite=Lax` cookie.
2. The access token is held **in memory only** — never `localStorage` — so an
   injected script cannot read it.
3. On page load the app calls `POST /api/auth/refresh`; the cookie silently
   restores the session.
4. On a `401`, `apiClient` refreshes once and replays the request. Concurrent
   401s collapse into a single refresh.
5. Every protected endpoint re-reads the user from the database. **The role in
   the token is advisory; the stored role is authoritative**, so revoking access
   takes effect immediately rather than at token expiry.

Public sign-up always creates a `customer`. Driver and admin accounts are
created by an admin — there is no code path that lets a caller choose its role.

---

## Booking flow

```
Customer                Admin                    Driver
────────                ─────                    ──────
requested  ──────────▶  confirmed
                        driver_assigned ──────▶  accepted
                                                 driver_arriving
                                                 picked_up
                                                 trip_started
                                                 completed
   └──────────── cancelled ────────────┘
```

`BOOKING_TRANSITIONS` in `app/models/enums.py` is the single definition of what
is legal. Anything not listed is rejected with a `409`, and **every** transition
is appended to `booking_status_history` with the actor and role.

The customer timeline shows the six milestones from the brief; the sub-states
(`accepted`, `picked_up`) appear as detail lines under their milestone rather
than as extra steps, so the phone view stays readable.

Side effects are handled centrally: vehicles flip to `on_trip` and back, driver
trip counts increment on completion, coupon usage is released on cancellation,
and a driver cannot be double-booked within a two-hour window.

---

## Pricing flow

**The backend is the only place a price is produced.** This is enforced in two
layers:

1. Request schemas set `extra="forbid"`, so a payload containing `total_fare`,
   `price` or `discount` is rejected with a `422` — the field is never silently
   ignored.
2. `booking_service.create_booking` recomputes the fare from the `pricing`
   collection at booking time and stores that. The client's quote is not trusted
   even as a hint.

The engine (`pricing_service.calculate_fare`):

```
travel     = (base_fare + per_km_rate × distance) × trip_type_multiplier
subtotal   = travel + driver_allowance + toll + night + airport + additional
total      = round(subtotal − discount + tax)
```

`fixed_fare` (route-based, the MVP model) short-circuits the first line. Adding
distance-based dynamic pricing means adding a branch in `_compute_components` —
no caller changes.

**Timezone matters here.** The night-surcharge window is evaluated in the
operator's local wall-clock time (`Asia/Kolkata` by default, configurable in
admin settings). Evaluating it in UTC would bill a 09:00 IST pickup as a night
trip, since that instant is 03:30 UTC. `app/core/timezone.py` is the only place
that converts an instant into a business day or hour; driver earnings and
report day-boundaries use it too.

---

## Permissions

Enforced in `app/api/deps.py` and re-checked in the service layer. The frontend
`ProtectedRoute` is a UX affordance, **not** a security boundary — bypassing it
gets you an empty shell and a `403`.

**Customer** — own bookings only (a request for someone else's booking returns
`404`, not `403`, so IDs cannot be probed); create bookings; cancel before
pickup; review completed trips; manage own profile and saved locations.

**Driver** — only trips assigned to them; advance status through their own
allowed subset; toggle availability (blocked until an admin verifies their
documents); view own earnings and documents. Cannot assign drivers, change
fares or cancel.

**Admin** — everything: confirm/cancel bookings, assign and reassign drivers,
override fares (with a mandatory reason, original price retained), record
payments, manage drivers, vehicles, routes, pricing, coupons, reviews, settings,
and suspend accounts.

Additional protections: bcrypt (cost 12) with a 72-byte guard, generic login
errors that do not reveal whether an account exists, per-IP rate limiting
(strict on login, looser on refresh since it fires once per page load), security
headers, CORS allowlist, and error handlers that never emit stack traces.

---

## Environment variables

### `backend/.env` — never committed

| Variable | Default | Notes |
| --- | --- | --- |
| `ENV` | `development` | `production` enables strict startup checks |
| `DEBUG` | `true` | must be `false` in production |
| `MONGODB_URI` | `mongodb://127.0.0.1:27017` | |
| `MONGODB_DB_NAME` | `localride` | |
| `JWT_SECRET` | dev placeholder | **≥32 random chars in production** |
| `ACCESS_TOKEN_EXPIRE_MINUTES` | `60` | |
| `REFRESH_TOKEN_EXPIRE_DAYS` | `14` | |
| `COOKIE_SECURE` | `false` | **must be `true` behind HTTPS** |
| `CORS_ORIGINS` | localhost:5173 | comma-separated |
| `AUTH_RATE_LIMIT` | `10` / 60s | login, register, change-password |
| `REFRESH_RATE_LIMIT` | `120` / 60s | separate bucket |
| `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` | demo values | change before deploying |
| `GOOGLE_MAPS_API_KEY` | empty | server-side only |
| `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET` | empty | not yet integrated |

Booting with `ENV=production` and a placeholder secret, `DEBUG=true`, or
`COOKIE_SECURE=false` raises at startup rather than running insecurely.

### `frontend/.env` — public values only

Anything prefixed `VITE_` is **compiled into the bundle and visible to end
users**. Never put a secret here.

| Variable | Notes |
| --- | --- |
| `VITE_API_BASE_URL` | empty in dev (uses the Vite proxy) |
| `VITE_API_PROXY_TARGET` | dev proxy destination |
| `VITE_BRAND_NAME`, `VITE_BRAND_TAGLINE`, `VITE_BRAND_SUPPORT_*` | rebranding |
| `VITE_GOOGLE_MAPS_API_KEY` | only if HTTP-referrer restricted in Google Cloud |

---

## Running tests

```bash
# Unit + integration (needs MongoDB; uses a throwaway database)
cd backend && pytest                      # 63 tests

# End-to-end HTTP against a running API
uvicorn app.main:app --port 8000 &
python -m scripts.smoke_test              # 132 checks

# Browser tests against a running dev server (needs Chrome)
cd frontend && npm run test:e2e           # 48 checks, fails on any console error
```

The browser tests drive your system Chrome via `playwright-core`, pinned to
1.45.3 because newer releases require Node 20+. Set `SHOT_DIR` to control where
screenshots are written (default `frontend/e2e/screenshots`, git-ignored).

The pytest suite uses a uniquely-named database per run and drops it afterwards,
so it never touches development data.

`smoke_test.py` deliberately exhausts the login rate-limit window as its last
step; re-run it after ~60 seconds if you run it twice in quick succession.

---

## Deployment

**Backend** — any container platform. `backend/Dockerfile` runs as a non-root
user. Set `ENV=production`, `DEBUG=false`, `COOKIE_SECURE=true`, a strong
`JWT_SECRET`, and `CORS_ORIGINS` to your real frontend origin. Terminate TLS at
the load balancer.

The rate limiter is **in-process**, so a single worker keeps it coherent. Before
scaling to multiple workers or instances, swap `_MemoryStore` in
`app/core/rate_limit.py` for a Redis-backed store — the dependency interface
does not change.

**Frontend** — `npm run build` emits static files to `dist/`. Serve them from
any static host or CDN. `frontend/Dockerfile` builds and serves via nginx, with
`/api` proxied to the backend so the browser stays same-origin.

**Database** — MongoDB Atlas or a managed instance. Indexes are created on
startup. Enable authentication and restrict network access; the app never needs
more than read/write on its own database.

**Before going live:** rotate `JWT_SECRET`, change or delete the seeded demo
accounts, set a real support phone and email in Settings, and confirm
`/docs` is disabled (it is, automatically, when `ENV=production`).

---

## What to build next

Deliberately **not** built, in rough priority order:

1. **Online payments** — the ledger is provider-agnostic; add a Razorpay
   provider plus a webhook route. No schema change needed.
2. **Real notification channels** — `notification_service` has the adapter
   interface; implement FCM, SMS or WhatsApp and register them. The UI already
   reports honestly which channels are live.
3. **Google Maps** — `maps_service.LocationProvider` is the seam. Add a
   `GoogleMapsProvider` for Places autocomplete and Distance Matrix.
4. **Live driver tracking** — add a WebSocket channel and a driver location
   ping. The booking record and status machine already support it.
5. **Distance-based dynamic pricing** — one branch in
   `pricing_service._compute_components`.
6. **Automated driver assignment** — `driver_service.assignable_drivers`
   already ranks candidates; add a scoring function.
7. **Redis-backed rate limiting** — required before horizontal scaling.
8. **Driver document uploads** — `documents[].file_url` exists; add object
   storage and an upload endpoint.
9. **Mobile apps** — the REST API is client-agnostic and needs no changes.

Not recommended yet (explicitly out of MVP scope): surge pricing, ride pooling,
wallets, loyalty programmes, corporate accounts, multi-city operations.

---

## Notes for the next developer

- **Never trust a client price.** If you add a booking-like endpoint, recompute
  the amount server-side and keep `extra="forbid"` on the request schema.
- **Anything that turns a timestamp into a business day or hour** goes through
  `app/core/timezone.py`. Storage stays UTC.
- **New booking states** go in `BOOKING_TRANSITIONS` first; the API, driver
  controls and timeline all read from it.
- **Rebranding** is `frontend/src/config/brand.js` plus company details in
  Admin → Settings. Grep for a hard-coded "LocalRide" before shipping a rename —
  there should be none outside that file and the seed script.
# near-me-cab
# near-me-cab
