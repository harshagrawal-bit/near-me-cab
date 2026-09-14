"""Application configuration.

Every value is sourced from the environment (see `.env.example`). Nothing
secret is ever hard-coded here — the defaults are development-only and the
app refuses to boot in production with a placeholder JWT secret.
"""

from __future__ import annotations

from functools import lru_cache
from typing import List

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

DEV_SECRET_PLACEHOLDER = "dev-only-insecure-secret-change-me"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=False,
    )

    # ---- Runtime ----
    ENV: str = "development"
    DEBUG: bool = True
    API_V1_PREFIX: str = "/api"
    PROJECT_NAME: str = "LocalRide API"

    # ---- Database ----
    MONGODB_URI: str = "mongodb://127.0.0.1:27017"
    MONGODB_DB_NAME: str = "localride"

    # ---- Auth ----
    JWT_SECRET: str = DEV_SECRET_PLACEHOLDER
    JWT_ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60
    REFRESH_TOKEN_EXPIRE_DAYS: int = 14
    REFRESH_COOKIE_NAME: str = "localride_refresh"
    # Cookie flags — must be True behind HTTPS in production.
    COOKIE_SECURE: bool = False
    COOKIE_SAMESITE: str = "lax"
    COOKIE_DOMAIN: str | None = None

    # ---- CORS ----
    # Comma-separated in the environment; read `cors_origins` for the parsed list.
    CORS_ORIGINS: str = "http://localhost:5173,http://127.0.0.1:5173"

    # ---- Rate limiting (in-process; see core/rate_limit.py) ----
    RATE_LIMIT_ENABLED: bool = True
    # Tight: these endpoints accept credentials, so they are brute-force targets.
    AUTH_RATE_LIMIT: int = 10  # requests
    AUTH_RATE_WINDOW_SECONDS: int = 60
    # Looser: /auth/refresh presents a signed cookie, not a guessable secret,
    # and fires once per page load. Sharing the login bucket would throttle
    # legitimate users behind a shared/NAT IP.
    REFRESH_RATE_LIMIT: int = 120
    REFRESH_RATE_WINDOW_SECONDS: int = 60
    WRITE_RATE_LIMIT: int = 60
    WRITE_RATE_WINDOW_SECONDS: int = 60

    # ---- Seed / bootstrap ----
    SEED_ADMIN_EMAIL: str = "admin@localride.in"
    SEED_ADMIN_PASSWORD: str = "Admin@12345"

    # ---- External services (placeholders — never commit real keys) ----
    GOOGLE_MAPS_API_KEY: str = ""
    #: OAuth client id for "Sign in with Google". Public by design — it is
    #: compiled into the frontend too. The *secret* is not needed for the
    #: ID-token flow this app uses, so there is none to leak.
    GOOGLE_CLIENT_ID: str = ""
    RAZORPAY_KEY_ID: str = ""
    RAZORPAY_KEY_SECRET: str = ""
    #: Verifies that a webhook really came from Razorpay. Server-side only.
    RAZORPAY_WEBHOOK_SECRET: str = ""

    # ---- Messaging ----
    #: Numbers are stored as 10 digits; providers want E.164. Prefixed with
    #: this unless the stored number already carries a country code.
    DEFAULT_COUNTRY_CODE: str = "+91"

    #: WhatsApp Cloud API (Meta). The phone number id is NOT the phone number —
    #: it is the id Meta assigns it in the WhatsApp Manager.
    WHATSAPP_PHONE_NUMBER_ID: str = ""
    WHATSAPP_ACCESS_TOKEN: str = ""
    #: WhatsApp only allows free-form text inside a 24-hour window after the
    #: customer last wrote to you. A booking update is almost always outside
    #: it, so proactive messages must use a pre-approved template. Leave this
    #: blank and the adapter sends plain text, which will be rejected outside
    #: that window — set it to your approved template name in production.
    WHATSAPP_TEMPLATE_NAME: str = ""
    WHATSAPP_TEMPLATE_LANG: str = "en"

    #: SMS via Twilio. In India, sending SMS also requires DLT registration of
    #: the sender id and templates with your operator — a Twilio account alone
    #: is not enough to deliver to Indian numbers.
    TWILIO_ACCOUNT_SID: str = ""
    TWILIO_AUTH_TOKEN: str = ""
    TWILIO_FROM_NUMBER: str = ""

    @property
    def cors_origins(self) -> List[str]:
        return [origin.strip() for origin in self.CORS_ORIGINS.split(",") if origin.strip()]

    @property
    def is_production(self) -> bool:
        return self.ENV.lower() in {"production", "prod"}

    def assert_production_safe(self) -> None:
        """Fail fast rather than run production with development secrets."""
        if not self.is_production:
            return
        problems = []
        if self.JWT_SECRET == DEV_SECRET_PLACEHOLDER or len(self.JWT_SECRET) < 32:
            problems.append("JWT_SECRET must be a strong random value (>= 32 chars).")
        if not self.COOKIE_SECURE:
            problems.append("COOKIE_SECURE must be true in production.")
        if self.DEBUG:
            problems.append("DEBUG must be false in production.")
        if problems:
            raise RuntimeError("Unsafe production configuration:\n - " + "\n - ".join(problems))


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
