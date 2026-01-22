# backend/python-service/app/main.py
import os
import sys
from dotenv import load_dotenv

# ------------------------------------------------------------------
# Load backend/.env FIRST (before anything else)
# ------------------------------------------------------------------
ENV_PATH = os.path.abspath(
    os.path.join(os.path.dirname(__file__), "..", "..", ".env")
)
load_dotenv(ENV_PATH)

# ------------------------------------------------------------------
# Path setup
# ------------------------------------------------------------------
BASE_DIR = os.path.dirname(__file__)
if BASE_DIR not in sys.path:
    sys.path.insert(0, BASE_DIR)

# ------------------------------------------------------------------
# Imports AFTER env is loaded
# ------------------------------------------------------------------
from fastapi import FastAPI
from fastapi.responses import JSONResponse
from core.config import Settings
from core.logging import configure_logging
from api.v1.router import router as api_router

# ------------------------------------------------------------------
# Init
# ------------------------------------------------------------------
configure_logging()
settings = Settings()

# ------------------------------------------------------------------
# Supabase debug log
# ------------------------------------------------------------------
import logging
_logger = logging.getLogger(__name__)

_supabase_url = os.environ.get("SUPABASE_URL")
_service_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
_anon_key = os.environ.get("SUPABASE_ANON_KEY")

if _supabase_url:
    key_preview = (
        f"{_service_key[:8]} (service)"
        if _service_key
        else f"{_anon_key[:8]} (anon)" if _anon_key else "no-key"
    )
    _logger.info(f"Supabase config: url={_supabase_url} key={key_preview}")

# Import and initialize centralized Supabase client (will validate access)
try:
    # Import here to ensure env loaded
    from core import supabase as supabase_core  # type: ignore
except Exception as e:
    _logger.error('Failed to initialize Python Supabase client', exc_info=e)

# ------------------------------------------------------------------
# FastAPI app
# ------------------------------------------------------------------
app = FastAPI(title=settings.APP_NAME)
app.include_router(api_router, prefix="/api/v1")

@app.get("/health")
async def health():
    return JSONResponse({"status": "ok", "service": settings.APP_NAME})

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
