# services/parser_service.py

import re
from typing import List, Tuple
from models.extraction import Field
from services import bl_parser
from services.bl_parser import (
    extract_bl_numbers,
    extract_containers,
    extract_seals,
    extract_weight,
)
from core.logging import get_logger

log = get_logger()


# ---------------------------------------------------------
# 🔒 VALIDATION MÉTIER BL (ANTI FAUX POSITIFS)
# ---------------------------------------------------------
def is_valid_bl_number(value: str) -> bool:
    if not value:
        return False

    # normalize: keep only letters+digits for validation
    v = ''.join(ch for ch in value.upper() if ch.isalnum())

    # length
    if len(v) < 6 or len(v) > 20:
        return False

    # must contain at least one digit and one letter
    if not any(c.isdigit() for c in v):
        return False
    if not any(c.isalpha() for c in v):
        return False

    # reject obvious repeats like 111111 or AAAAAA
    if re.fullmatch(r'(\d)\1{4,}', v) or re.fullmatch(r'([A-Z])\1{4,}', v):
        return False

    # blacklist / noisy tokens
    INVALID = {
        'RECEIVED', 'COPY', 'ORIGINAL', 'DRAFT', 'ISSUED', 'RELEASED', 'CONFIRMED',
        'TOTAL', 'KGS', 'KG', 'MT', 'TON', 'TONS', 'PAGE'
    }
    if v in INVALID:
        return False

    return True


def parse_document_text(text: str, doc_type: str) -> List[Field]:
    fields: List[Field] = []

    # ---------------------------------------------------------
    # 0️⃣ NORMALISATION DU TYPE (CRITIQUE)
    # ---------------------------------------------------------
    normalized_type = str(doc_type).upper().strip() if doc_type else ""

    if normalized_type in {
        "BL",
        "B L",
        "B / L",
        "BILL OF LADING",
        "BILL OF LADING NO",
        "BILL OF LADING NUMBER",
    }:
        normalized_type = "BL"

    log.info(
        "parse_document_text.start",
        extra={
            "original_doc_type": doc_type,
            "normalized_doc_type": normalized_type,
            "text_len": len(text or ""),
        },
    )

    if not text:
        log.info("parse_document_text.empty")
        return fields

    # -----------------------
    # BILL OF LADING
    # -----------------------
    if normalized_type == "BL":
        # 1️⃣ BL NUMBER (CRITIQUE) - try primary engine
        bl_number = bl_parser.pick_best_bl(text)
        bl_status = None

        if bl_number and is_valid_bl_number(bl_number):
            fields.append(Field(key="bl_number", value=bl_number, confidence=0.95))
            bl_status = 'ACCEPTED'
        else:
            if bl_number:
                log.warning('bl_number.rejected', extra={'value': bl_number})
                bl_status = 'REJECTED_BY_VALIDATION'

            # 2️⃣ Fallback: analyze candidates from extract_bl_numbers
            candidates = extract_bl_numbers(text)
            valid_candidates: List[Tuple[str, int]] = []
            for c in candidates:
                if not c:
                    continue
                if not is_valid_bl_number(c):
                    continue
                # If candidate is inside a container-list section and there is no explicit
                # BL label nearby, skip it to avoid false positives from container lists.
                try:
                    if bl_parser.is_within_container_section(text, c) and not bl_parser.has_explicit_bl_label_near(text, c):
                        log.info('fallback.skip_container_section', extra={'token': c})
                        continue
                except Exception:
                    pass
                # lightweight scoring
                score = 0
                # proximity to explicit BL labels
                try:
                    if bl_parser.has_explicit_bl_label_near(text, c):
                        score += 50
                    if bl_parser.candidate_near_bl_keyword(text, c, window=80):
                        score += 25
                    # prefer longer / more structured tokens
                    score += min(len(c), 30)
                    # penalize if in seal/container contexts but do not reject
                    if bl_parser.is_seal_number_context(text, c):
                        score -= 40
                    if bl_parser.is_within_container_section(text, c):
                        score -= 30
                except Exception:
                    # defensive: if helper not available, rely on length
                    score = len(c)
                valid_candidates.append((c, score))

            if valid_candidates:
                # choose best scoring candidate
                valid_candidates.sort(key=lambda x: (x[1], len(x[0])), reverse=True)
                best_cand, best_score = valid_candidates[0]
                fields.append(Field(key="bl_number", value=best_cand, confidence=0.75))
                bl_status = 'FALLBACK_USED'

                # log decision trace
                log.info('BL_DECISION_TRACE', extra={
                    'chosen': best_cand,
                    'score': best_score,
                    'candidates': [{'token': t, 'score': s} for t, s in valid_candidates],
                })
            else:
                # no valid candidates
                fields.append(Field(key="bl_number", value=None, confidence=0.2))
                if not bl_status:
                    bl_status = 'NO_BL_FOUND'

        # Append detection status for support/audit if not accepted
        if bl_status and bl_status != 'ACCEPTED':
            fields.append(Field(key='bl_detection_status', value=bl_status, confidence=0.3))

        # 2️⃣ Autres BL détectés (debug / audit)
        other_bls = extract_bl_numbers(text)
        if other_bls:
            fields.append(Field(key="bl_numbers_detected", value=other_bls, confidence=0.7))

        # 3️⃣ Containers
        containers = extract_containers(text)
        if containers:
            fields.append(
                Field(
                    key="containers",
                    value=containers,
                    confidence=0.9,
                )
            )

        # 4️⃣ Seals
        seals = extract_seals(text)
        if seals:
            fields.append(
                Field(
                    key="seals",
                    value=seals,
                    confidence=0.75,
                )
            )

        # 5️⃣ Weight
        weight = extract_weight(text)
        if weight:
            fields.append(
                Field(
                    key="weight",
                    value=weight,
                    confidence=0.8,
                )
            )

        return fields

    # -----------------------
    # IM8
    # -----------------------
    if normalized_type == "IM8":
        fields.append(
            Field(
                key="im8_reference",
                value=None,
                confidence=0.5,
            )
        )
        return fields

    # -----------------------
    # UNKNOWN
    # -----------------------
    fields.append(
        Field(
            key="raw_text_snippet",
            value=text[:200],
            confidence=0.4,
        )
    )

    log.info(
        "parse_document_text.end",
        extra={"doc_type": normalized_type, "fields_count": len(fields)},
    )
    return fields
