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
    _logger.info(
        "Supabase configuration loaded",
        extra={
            "url_configured": True,
            "service_key_configured": bool(_service_key),
            "anon_key_configured": bool(_anon_key),
        },
    )

# Import and initialize centralized Supabase client (will validate access)
supabase_ready = False
try:
    # Import here to ensure env loaded
    from core import supabase as supabase_core  # type: ignore
except Exception as e:
    _logger.error('Failed to initialize Python Supabase client', exc_info=e)
else:
    supabase_ready = True

# ------------------------------------------------------------------
# FastAPI app
# ------------------------------------------------------------------
app = FastAPI(title=settings.APP_NAME)
app.state.supabase_ready = supabase_ready
app.include_router(api_router, prefix="/api/v1")

@app.get("/health")
async def health():
    return JSONResponse({"status": "ok", "service": settings.APP_NAME})

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
