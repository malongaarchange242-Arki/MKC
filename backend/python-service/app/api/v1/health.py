import shutil

import pytesseract
from fastapi import APIRouter, HTTPException, Request

router = APIRouter()


@router.get('/health')
async def health():
    return {"status": "ok", "service": "FERI-AD Document Service"}


def _ocr_status() -> dict:
    try:
        languages = set(pytesseract.get_languages(config=""))
        version = str(pytesseract.get_tesseract_version())
        if not {"eng", "fra"}.issubset(languages) or not shutil.which("pdfinfo"):
            return {"status": "unavailable", "service": "OCR"}
    except Exception as exc:
        raise HTTPException(
            status_code=503,
            detail={"status": "unavailable", "service": "OCR"},
        ) from exc
    return {
        "status": "ok",
        "service": "OCR",
        "tesseract_version": version,
        "languages": ["eng", "fra"],
        "pdf_renderer": "poppler",
    }


@router.get('/health/ocr')
async def ocr_health():
    status = _ocr_status()
    if status["status"] != "ok":
        raise HTTPException(
            status_code=503,
            detail=status,
        )
    return status


@router.get('/health/ready')
async def readiness(request: Request):
    checks = {
        "supabase": "ok" if request.app.state.supabase_ready else "unavailable",
        "ocr": "ok",
    }
    try:
        ocr = _ocr_status()
        checks["ocr"] = ocr["status"]
    except HTTPException:
        checks["ocr"] = "unavailable"

    if "unavailable" in checks.values():
        raise HTTPException(
            status_code=503,
            detail={"status": "unavailable", "checks": checks},
        )
    return {"status": "ok", "checks": checks}
