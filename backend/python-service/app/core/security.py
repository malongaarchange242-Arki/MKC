from fastapi import Header, HTTPException
from core.config import get_settings


def verify_api_key(x_api_key: str = Header(None)):
    settings = get_settings()
    if x_api_key is None or x_api_key != settings.API_KEY:
        raise HTTPException(status_code=401, detail="Invalid API key")
    return True
