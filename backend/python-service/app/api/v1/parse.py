from fastapi import APIRouter, HTTPException
import re
from models.document import DocumentInput
from models.extraction import ExtractionResponse, Field
from services.classifier import classify_document
from services.ocr_service import ocr_from_url
from services.bl_parser import (
    pick_best_bl,
    extract_containers,
    extract_seals,
    extract_weight,
)
from services.confidence import final_confidence
from utils.hashing import hash_text
from core.logging import get_logger

router = APIRouter()
log = get_logger()


# ---------------------------------------------------------
# Helpers
# ---------------------------------------------------------
def _extract_after(text: str, key: str, limit: int = 240) -> str | None:
    """
    Extract text appearing after a keyword (VESSEL, VOYAGE, etc.).
    Works on OCR-normalized uppercase text.
    """
    if not text:
        return None

    pattern = rf"{re.escape(key)}[\s#:\.\-]+(.+)"
    m = re.search(pattern, text, re.IGNORECASE)
    if not m:
        return None

    return m.group(1).strip()[:limit]


# ---------------------------------------------------------
# Route
# ---------------------------------------------------------
@router.post("/parse/document", response_model=ExtractionResponse)
async def parse_document(payload: DocumentInput):
    try:
        # -------------------------------------------------
        # 0️⃣ HINT NORMALISATION
        # -------------------------------------------------
        hint_raw = (payload.hint or "").strip()
        hint = hint_raw.lower()

        BL_HINTS = {
            "bill_of_lading",
            "bill-of-lading",
            "bill of lading",
            "billoflading",
            "bl",
            "b/l",
        }

        is_bl_hint = hint in BL_HINTS

        log.info(
            "parse.start",
            extra={
                "document_id": payload.document_id,
                "hint": hint_raw,
                "is_bl_hint": is_bl_hint,
            },
        )

        # -------------------------------------------------
        # 1️⃣ OCR (SEULEMENT SI BL)
        # -------------------------------------------------
        if not is_bl_hint:
            inferred = classify_document(hint_raw, "")
            log.info(
                "parse.skip_ocr",
                extra={
                    "document_id": payload.document_id,
                    "inferred_type": inferred,
                },
            )
            return ExtractionResponse(
                document_type=inferred,
                fields=[],
                raw_text_hash="",
                raw_text_snippet="",
                extraction=None,
            )

        try:
            ocr_text = ocr_from_url(payload.file_url) or ""
        except Exception as e:
            log.exception("ocr.failed", extra={"url": payload.file_url})
            ocr_text = ""

        if not ocr_text.strip():
            log.warning("ocr.empty", extra={"document_id": payload.document_id})

        log.info(
            "ocr.done",
            extra={
                "document_id": payload.document_id,
                "text_len": len(ocr_text),
                "preview": ocr_text[:400],
            },
        )

        # ⚠️ CRITIQUE :
        # ocr_service retourne DÉJÀ un texte normalisé (UPPERCASE, lignes propres)
        text = ocr_text

        # -------------------------------------------------
        # 2️⃣ BL DETECTION (SOURCE DE VÉRITÉ UNIQUE)
        # -------------------------------------------------
        bl_value = pick_best_bl(text)
        # Backwards-compat: pick_best_bl may return a dict {bl_number, confidence, reason}
        bl_result = None
        if isinstance(bl_value, dict):
            bl_result = bl_value
            bl_value = bl_value.get('bl_number')
        fields: list[Field] = []
        extraction = None
        doc_type = "BL"

        if bl_value:
            # compute final confidence using existing service; pass string candidate
            conf = final_confidence(text, bl_value, ["BL", "B/L", "BILL"])
            fields.append(Field(key="bl_number", value=bl_value, confidence=conf))
            # attach reason from new parser if available
            if bl_result and 'reason' in bl_result:
                log.info('bl.parser_reason', extra={'reason': bl_result.get('reason')})

            log.info(
                "bl.detected",
                extra={
                    "document_id": payload.document_id,
                    "bl": bl_value,
                    "confidence": conf,
                },
            )

            # -------------------------------------------------
            # 3️⃣ EXTRACTION BL DÉTAILLÉE
            # -------------------------------------------------
            extraction = {
                "status": "parsed",
                "bl_detected": True,
                "bl_number": bl_value,
                "bl_score": conf,
                "vessel": _extract_after(text, "VESSEL"),
                "voyage": _extract_after(text, "VOYAGE NO")
                or _extract_after(text, "VOYAGE"),
                "shipper": _extract_after(text, "SHIPPER"),
                "consignee": _extract_after(text, "CONSIGNEE"),
                "containers": extract_containers(text),
                "seals": extract_seals(text),
                "weight": extract_weight(text),
            }

            # Date extraction (soft)
            m_date = re.search(
                r"\b(\d{4}-\d{2}-\d{2}|\d{2}/\d{2}/\d{4}|\d{4}/\d{2}/\d{2})\b",
                text,
            )
            if m_date:
                extraction["shipped_on_board_date"] = m_date.group(1)

        else:
            # BL hint but no BL detected → soft failure
            extraction = {
                "status": "parsed",
                "bl_detected": False,
                "reason": "BL_HINT_BUT_NOT_DETECTED",
            }
            log.warning(
                "bl.not_detected",
                extra={"document_id": payload.document_id},
            )

        # -------------------------------------------------
        # 4️⃣ RESPONSE
        # -------------------------------------------------
        response = ExtractionResponse(
            document_type=doc_type,
            fields=fields,
            raw_text_hash=hash_text(text),
            raw_text_snippet=text[:800],
            extraction=extraction,
        )

        log.info(
            "parse.done",
            extra={
                "document_id": payload.document_id,
                "bl": bl_value,
                "fields": [f.dict() for f in fields],
            },
        )

        return response

    except Exception:
        log.exception("parse.unhandled_exception")
        raise HTTPException(status_code=500, detail="Document parsing failed")
