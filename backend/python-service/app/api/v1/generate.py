from fastapi import APIRouter, HTTPException
from fastapi.responses import Response
from models.generation import GenerationRequest
from services.pdf_service import generate_pdf_from_template
from core.logging import get_logger

router = APIRouter()
log = get_logger()


def _build_pdf_response(pdf_bytes: bytes, filename: str) -> Response:
    if not pdf_bytes:
        raise HTTPException(
            status_code=500,
            detail="PDF generation failed: empty output",
        )

    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            "Content-Length": str(len(pdf_bytes)),
        },
    )


@router.post("/generate/feri")
async def generate_feri(payload: GenerationRequest):
    """
    Generate FERI PDF document.
    """
    try:
        log.info(
            "generate_feri.start",
            extra={
                "request_id": payload.request_id,
                "output_filename": payload.output_filename,
            },
        )

        pdf_bytes = generate_pdf_from_template(
            template_name="feri",
            data=payload.data,
            output_filename=payload.output_filename,
        )

        filename = payload.output_filename or f"feri_{payload.request_id}.pdf"

        log.info(
            "generate_feri.success",
            extra={
                "request_id": payload.request_id,
                "filename": filename,
                "size": len(pdf_bytes),
            },
        )

        return _build_pdf_response(pdf_bytes, filename)

    except HTTPException:
        raise
    except Exception as e:
        log.exception(
            "generate_feri.failed",
            extra={"request_id": payload.request_id},
        )
        raise HTTPException(
            status_code=500,
            detail="FERI PDF generation failed",
        )


@router.post("/generate/ad")
async def generate_ad(payload: GenerationRequest):
    """
    Generate AD PDF document.
    """
    try:
        log.info(
            "generate_ad.start",
            extra={
                "request_id": payload.request_id,
                "output_filename": payload.output_filename,
            },
        )

        pdf_bytes = generate_pdf_from_template(
            template_name="ad",
            data=payload.data,
            output_filename=payload.output_filename,
        )

        filename = payload.output_filename or f"ad_{payload.request_id}.pdf"

        log.info(
            "generate_ad.success",
            extra={
                "request_id": payload.request_id,
                "filename": filename,
                "size": len(pdf_bytes),
            },
        )

        return _build_pdf_response(pdf_bytes, filename)

    except HTTPException:
        raise
    except Exception as e:
        log.exception(
            "generate_ad.failed",
            extra={"request_id": payload.request_id},
        )
        raise HTTPException(
            status_code=500,
            detail="AD PDF generation failed",
        )
