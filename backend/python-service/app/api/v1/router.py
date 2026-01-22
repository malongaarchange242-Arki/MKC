from fastapi import APIRouter, Depends
from core.security import verify_api_key
from . import health, parse, generate

router = APIRouter()

# Protect v1 API with API key - only Node should call these endpoints
router.include_router(health.router, prefix="")
router.include_router(parse.router, prefix="", dependencies=[Depends(verify_api_key)])
router.include_router(generate.router, prefix="", dependencies=[Depends(verify_api_key)])
