from fastapi import APIRouter, HTTPException
import re as _re
from models.document import DocumentInput
from models.extraction import ExtractionResponse, Field
from services.classifier import classify_document
from utils.text_normalizer import normalize_text
from services.ocr_service import ocr_from_url
from services.bl_parser import (
    extract_bl_numbers,
    extract_containers,
    extract_seals,
    extract_weight,
)
from services.confidence import final_confidence
from utils.hashing import hash_text
from core.logging import get_logger

router = APIRouter()
log = get_logger()

def _extract_after_helper(text: str, key: str) -> str:
    """Helper interne pour extraire du texte après un mot-clé."""
    if not text: return None
    idx = text.find(key)
    if idx == -1: return None
    snippet = text[idx:idx+400]
    parts = snippet.split('\n') if '\n' in snippet else snippet.split('.')
    if len(parts) > 1:
        return parts[1].strip()[:240]
    return None

@router.post('/parse/document', response_model=ExtractionResponse)
async def parse_document(payload: DocumentInput):
    try:
        # 1. OCR
        try:
            raw_text = ocr_from_url(payload.file_url)
        except Exception as e:
            log.error(f'Failed fetching/OCR from url: {payload.file_url}', exc_info=e)
            raw_text = ''

        ocr_text = raw_text or ''
        norm_text = normalize_text(ocr_text)
        
        log.info("OCR_RESULT", extra={
            "document_id": payload.document_id,
            "text_length": len(ocr_text),
            "text_preview": ocr_text[:500]
        })

        # 2. Classification / Hint
        hint = (payload.hint or '').strip().lower()
        if hint in ("bill_of_lading", "bill-of-lading", "bill of lading", "bl"):
            doc_type = "BL"
        else:
            doc_type = classify_document(payload.hint or '', norm_text)

        # 3. Detection & Extraction
        fields = []
        bl_value = None
        extraction = {}

        # Tentative de détection du numéro de BL par format
        bl_candidates = extract_bl_numbers(norm_text)
        
        if bl_candidates:
            doc_type = 'BL' # On force le type si on trouve un format BL
            bl_value = bl_candidates[0]
            conf = final_confidence(ocr_text, bl_value, ['BL', 'B/L', 'BILL'])
            fields.append(Field(key='bl_number', value=bl_value, confidence=conf))
            log.info('Picked BL (format-first)', extra={'bl_value': bl_value, 'conf': conf})

        # 4. Remplissage des détails SI c'est un BL
        if doc_type == 'BL':
            extraction = {
                'status': 'parsed',
                'bl_detected': True if bl_value else False,
                'bl_number': bl_value,
                'vessel': _extract_after_helper(raw_text, 'Vessel') or _extract_after_helper(raw_text, 'VESSEL'),
                'voyage': _extract_after_helper(raw_text, 'Voyage') or _extract_after_helper(raw_text, 'Voyage No'),
                'shipper': _extract_after_helper(raw_text, 'Shipper'),
                'consignee': _extract_after_helper(raw_text, 'Consignee'),
                'containers': extract_containers(raw_text),
                'seals': extract_seals(raw_text),
                'weight': extract_weight(raw_text)
            }
            
            # Date extraction
            date_match = _re.search(r'(\d{4}-\d{2}-\d{2}|\d{2}/\d{2}/\d{4}|\d{4}/\d{2}/\d{2})', raw_text)
            if date_match:
                extraction['shipped_on_board_date'] = date_match.group(0)

        elif doc_type == 'IM8':
            fields.append(Field(key='im8_ref', value='IM8_PENDING', confidence=0.5))
        
        # 5. Final Response
        # Calcul de la confiance globale
        final_conf = 0.0
        if fields:
            final_conf = max((f.confidence for f in fields), default=0.0)
        elif doc_type == 'BL' and bl_value:
            final_conf = 0.9
            
        response = ExtractionResponse(
            document_type=doc_type,
            fields=fields,
            raw_text_hash=hash_text(ocr_text),
            raw_text_snippet=ocr_text[:800],
            extraction=extraction if extraction else None
        )

        log.info(
            "PARSE_RESPONSE",
            extra={
                "document_id": payload.document_id,
                "document_type": response.document_type,
                "fields": [f.dict() for f in response.fields],
                "extraction": response.extraction,
            },
        )

        return response


    except Exception as e:
        log.exception('Unhandled exception in parse_document')
        raise HTTPException(status_code=500, detail=str(e))