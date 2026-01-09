# services/parser_service.py

from typing import List
from models.extraction import Field
from services.bl_parser import (
    pick_best_bl,
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

    v = value.strip().upper()

    # Un BL a TOUJOURS des chiffres
    if not any(c.isdigit() for c in v):
        return False

    # Blacklist métier (statuts / mots OCR fréquents)
    INVALID = {
        "RECEIVED",
        "COPY",
        "ORIGINAL",
        "DRAFT",
        "ISSUED",
        "RELEASED",
        "CONFIRMED",
    }

    if v in INVALID:
        return False

    # Longueur réaliste BL
    return 6 <= len(v) <= 20


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
        # 1️⃣ BL NUMBER (CRITIQUE)
        bl_number = pick_best_bl(text)

        if bl_number and is_valid_bl_number(bl_number):
            fields.append(
                Field(
                    key="bl_number",
                    value=bl_number,
                    confidence=0.95,
                )
            )
        else:
            if bl_number:
                log.warning(
                    "bl_number.rejected",
                    extra={"value": bl_number},
                )

            fields.append(
                Field(
                    key="bl_number",
                    value=None,
                    confidence=0.2,
                )
            )

        # 2️⃣ Autres BL détectés (debug / audit)
        other_bls = extract_bl_numbers(text)
        if other_bls:
            fields.append(
                Field(
                    key="bl_numbers_detected",
                    value=other_bls,
                    confidence=0.7,
                )
            )

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
