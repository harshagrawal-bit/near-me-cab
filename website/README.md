# NearMe Cab — public website

A single static page: `index.html`, `styles.css`, `app.js`. No build step, no
framework, no node_modules. Open `index.html` to read the whole thing.

## How it connects

It calls `/api/public/*` on the same origin, so a booking made here lands in
the same database as the app and shows up in the admin console and the drivers'
open-trips list. Nothing here is a separate inbox.

The public endpoints are deliberately narrow:

| Endpoint | Purpose |
| --- | --- |
| `GET /api/public/company` | Phone, email, address, cancellation rule |
| `GET /api/public/routes` | Routes we operate, for the popular-routes grid |
| `GET /api/public/places` | Suggestions for the From/To fields |
| `POST /api/public/quote` | Fare options — the server prices, never the client |
| `POST /api/public/bookings` | Create a booking without an account |
| `GET /api/public/bookings/{ref}` | Check a booking, reference **and** phone required |

A booking creates (or reuses) a customer keyed on the phone number, so a
regular caller builds one history rather than a dozen disconnected records.
That account has no usable password until the person registers properly.

Guest bookings settle with the driver. Paying online needs an account, and
inventing a payment session for someone we cannot authenticate is not worth
the attack surface.

## Serving it

Same origin as the API is the simplest arrangement and the one the code
assumes — it avoids CORS entirely. With nginx:

```nginx
server {
    server_name nearmecab.in;

    # The website
    root /var/www/nearmecab-website;
    index index.html;
    location / { try_files $uri $uri/ /index.html; }

    # The app (built Vite output)
    location /app/ { alias /var/www/nearmecab-app/; try_files $uri $uri/ /index.html; }

    # The API
    location /api/ {
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

If you ever serve the site from a different host to the API, set the base
before `app.js` loads and add that origin to `CORS_ORIGINS`:

```html
<script>window.NEARME_API_BASE = 'https://api.nearmecab.in'</script>
```

## Rate limiting

`POST /quote` and `POST /bookings` are capped at 20 requests per minute per IP.
There is no account behind a caller here, so that number is the only thing
between a scripted form and a few thousand junk bookings.
