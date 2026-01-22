# core/security.py
from typing import Optional
from fastapi import Header, HTTPException, status
from core.config import get_settings


def verify_api_key(x_api_key: Optional[str] = Header(None), authorization: Optional[str] = Header(None)):
    """Verify incoming request is authorized to call internal Python APIs.

    Accept either the `x-api-key` header or `Authorization: Bearer <key>`.
    Comparison trims surrounding whitespace to be robust to minor formatting issues.
    """
    settings = get_settings()

    if not settings.PYTHON_SERVICE_API_KEY:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="PYTHON_SERVICE_API_KEY not configured"
        )

    provided_key = None
    if x_api_key:
        provided_key = x_api_key
    elif authorization and authorization.lower().startswith('bearer '):
        provided_key = authorization.split(' ', 1)[1]

    if not provided_key or provided_key.strip() != settings.PYTHON_SERVICE_API_KEY.strip():
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid API key"
        )

    return True
