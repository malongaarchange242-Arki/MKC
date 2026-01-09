from fastapi import APIRouter, HTTPException
from fastapi.responses import Response
from models.generation import GenerationRequest
from services.pdf_service import generate_pdf_from_template

router = APIRouter()


@router.post('/generate/feri')
async def generate_feri(payload: GenerationRequest):
    try:
        pdf_bytes = generate_pdf_from_template('feri', payload.data, payload.output_filename)
        filename = payload.output_filename or f"feri_{payload.request_id}.pdf"
        return Response(content=pdf_bytes, media_type='application/pdf', headers={'Content-Disposition': f'attachment; filename="{filename}"'})
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post('/generate/ad')
async def generate_ad(payload: GenerationRequest):
    try:
        pdf_bytes = generate_pdf_from_template('ad', payload.data, payload.output_filename)
        filename = payload.output_filename or f"ad_{payload.request_id}.pdf"
        return Response(content=pdf_bytes, media_type='application/pdf', headers={'Content-Disposition': f'attachment; filename="{filename}"'})
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
