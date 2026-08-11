"""Authentication request/response schemas."""

from __future__ import annotations

from pydantic import EmailStr, Field, field_validator

from app.models.enums import Role
from app.schemas.common import ApiModel, Phone, ResponseModel

MIN_PASSWORD_LENGTH = 8


def _validate_password(value: str) -> str:
    if len(value) < MIN_PASSWORD_LENGTH:
        raise ValueError("Password must be at least 8 characters.")
    if len(value.encode("utf-8")) > 72:
        raise ValueError("Password must be at most 72 bytes.")
    if value.isdigit() or value.isalpha():
        raise ValueError("Password must mix letters with a number or symbol.")
    return value


class RegisterRequest(ApiModel):
    name: str = Field(min_length=2, max_length=80)
    email: EmailStr
    phone: Phone
    password: str

    _check_password = field_validator("password")(_validate_password)

    @field_validator("email")
    @classmethod
    def lower_email(cls, value: str) -> str:
        return value.lower()


class LoginRequest(ApiModel):
    email: EmailStr
    password: str = Field(min_length=1, max_length=128)

    @field_validator("email")
    @classmethod
    def lower_email(cls, value: str) -> str:
        return value.lower()


class GoogleSignIn(ApiModel):
    """The ID token Google Identity Services hands the client.

    Only the token is accepted — deliberately not an email or name. Anything
    the client could assert about who they are would be worthless; the identity
    comes from Google's signature over this token and nowhere else.
    """

    credential: str = Field(min_length=20, max_length=4096)


class ChangePasswordRequest(ApiModel):
    current_password: str = Field(min_length=1, max_length=128)
    new_password: str

    _check_password = field_validator("new_password")(_validate_password)


class SavedLocation(ApiModel):
    label: str = Field(min_length=1, max_length=40)
    address: str = Field(min_length=3, max_length=200)
    lat: float | None = Field(default=None, ge=-90, le=90)
    lng: float | None = Field(default=None, ge=-180, le=180)


class UpdateProfileRequest(ApiModel):
    name: str | None = Field(default=None, min_length=2, max_length=80)
    phone: Phone | None = None
    email: EmailStr | None = None
    avatar_url: str | None = Field(default=None, max_length=500)
    saved_locations: list[SavedLocation] | None = Field(default=None, max_length=10)

    @field_validator("email")
    @classmethod
    def lower_email(cls, value: str | None) -> str | None:
        return value.lower() if value else value


class UserPublic(ResponseModel):
    id: str
    name: str
    email: str
    phone: str
    role: Role
    status: str
    avatar_url: str | None = None
    saved_locations: list[SavedLocation] = Field(default_factory=list)
    created_at: str | None = None


class TokenResponse(ResponseModel):
    access_token: str
    token_type: str = "bearer"
    expires_in: int
    user: UserPublic
