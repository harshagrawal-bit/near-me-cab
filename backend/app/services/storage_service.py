"""Where uploaded files actually live.

Local disk by design. On a VPS that is a directory you own, back up with
everything else, and pay nothing for — object storage would mean a second
vendor, a second set of credentials and a second thing to get wrong, to solve
a problem a few thousand licence scans do not have.

These are identity documents, so nothing here is served statically. Files are
written under generated names with no guessable relationship to the driver,
and the only way to read one back is an authenticated route that re-checks who
is asking. A scan sitting behind a public URL is a data breach waiting for
someone to guess a filename.

`UPLOAD_DIR` is the single place to change if this ever moves to S3: swap the
two functions below for a client and nothing above them cares.
"""

from __future__ import annotations

import logging
import secrets
from pathlib import Path

from app.core.config import settings
from app.core.errors import ValidationError

logger = logging.getLogger("localride.storage")

#: Scans and photos only. No archives, no office formats, nothing executable.
ALLOWED_TYPES: dict[str, str] = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "application/pdf": ".pdf",
}

MAX_BYTES = 8 * 1024 * 1024  # 8 MB — a phone photo of a licence, with room spare


def upload_root() -> Path:
    root = Path(settings.UPLOAD_DIR).expanduser().resolve()
    root.mkdir(parents=True, exist_ok=True)
    return root


def save_document(data: bytes, content_type: str, *, prefix: str = "doc") -> str:
    """Write a file and return the key used to read it back.

    The key carries no driver id, document type or original filename: a key
    that leaks in a log or a screenshot should say nothing about whose it is.
    """
    if content_type not in ALLOWED_TYPES:
        raise ValidationError("Upload a JPG, PNG or PDF.")
    if not data:
        raise ValidationError("That file is empty.")
    if len(data) > MAX_BYTES:
        raise ValidationError(f"Files must be under {MAX_BYTES // (1024 * 1024)} MB.")

    # Cheap sanity check that the bytes match the declared type. Stops the
    # obvious case of an executable renamed to .jpg; it is not a virus scanner.
    if content_type == "application/pdf" and not data.startswith(b"%PDF"):
        raise ValidationError("That does not look like a PDF.")
    if content_type == "image/png" and not data.startswith(b"\x89PNG"):
        raise ValidationError("That does not look like a PNG.")
    if content_type == "image/jpeg" and not data.startswith(b"\xff\xd8"):
        raise ValidationError("That does not look like a JPG.")

    key = f"{prefix}_{secrets.token_urlsafe(24)}{ALLOWED_TYPES[content_type]}"
    path = upload_root() / key
    path.write_bytes(data)
    path.chmod(0o600)
    logger.info("Stored upload %s (%d bytes)", key, len(data))
    return key


def read_document(key: str) -> tuple[bytes, str]:
    """Read a stored file back, refusing anything that escapes the directory."""
    root = upload_root()
    path = (root / key).resolve()
    # Without this, a key of "../../etc/passwd" reads whatever the process can.
    if not str(path).startswith(str(root)) or not path.is_file():
        raise ValidationError("File not found.")
    suffix = path.suffix.lower()
    content_type = next(
        (mime for mime, ext in ALLOWED_TYPES.items() if ext == suffix), "application/octet-stream"
    )
    return path.read_bytes(), content_type


def delete_document(key: str) -> None:
    try:
        path = (upload_root() / key).resolve()
        if str(path).startswith(str(upload_root())) and path.is_file():
            path.unlink()
    except OSError:
        logger.warning("Could not delete upload %s", key)
