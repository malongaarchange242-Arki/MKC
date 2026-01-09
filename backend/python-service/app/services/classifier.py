# services/classifier.py
from typing import Optional
from core.logging import get_logger
import re


def classify_document(hint: Optional[str], text_or_filename: str) -> str:
    """
    Classify document type using hint first, then OCR text (preferred),
    falling back to filename heuristics.
    """
    log = get_logger()
    T = (text_or_filename or "").upper()

    log.debug(
        "classify_document.start",
        extra={"hint": hint, "text_len": len(T)},
    )

    # -------------------------------------------------
    # 1️⃣ HINT EXPLICITE (priorité absolue)
    # -------------------------------------------------
    if hint:
        h = hint.strip().upper()
        if h in {"BL", "BILL OF LADING", "BILL_OF_LADING"}:
            return "BL"
        if h == "IM8":
            return "IM8"

    bl_score = 0.0
    im8_score = 0.0

    # -------------------------------------------------
    # 2️⃣ NORMALISATION OCR (CRITIQUE)
    # -------------------------------------------------
    # Supprime espaces entre lettres OCR: B I L L -> BILL
    compact = re.sub(r"\s+", "", T)

    # -------------------------------------------------
    # 3️⃣ SIGNAUX BL FORTS (structure + label)
    # -------------------------------------------------
    BL_STRONG_PATTERNS = [
        r"BILL\s*OF\s*LADING",
        r"BILL\s*OF\s*LADING\s*(NO|NUMBER)",
        r"B/L\s*(NO|NUMBER)",
        r"\bBL\s*(NO|NUMBER)\b",
    ]

    for p in BL_STRONG_PATTERNS:
        if re.search(p, T):
            bl_score += 3

    # OCR compacté (fallback)
    if any(x in compact for x in (
        "BILLOFLADING",
        "BILLOFLADINGNO",
        "BILLOFLADINGNUMBER",
        "BLNO",
        "BLNUMBER",
    )):
        bl_score += 2

    # -------------------------------------------------
    # 4️⃣ SIGNAUX BL FAIBLES (contexte maritime)
    # -------------------------------------------------
    BL_WEAK_KEYWORDS = [
        "CONSIGNEE",
        "SHIPPER",
        "PORT OF LOADING",
        "PORT OF DISCHARGE",
        "VESSEL",
        "VOYAGE",
        "CONTAINER",
        "SEAL",
        "GROSS WEIGHT",
        "NET WEIGHT",
    ]

    for k in BL_WEAK_KEYWORDS:
        if k in T:
            bl_score += 0.5

    # -------------------------------------------------
    # 5️⃣ SIGNAUX IM8
    # -------------------------------------------------
    IM8_PATTERNS = [
        r"\bIM8\b",
        r"DECLARATION\s+IM8",
        r"DOUANE",
        r"REPUBLIQUE\s+DU\s+CONGO",
        r"RDC",
    ]

    for p in IM8_PATTERNS:
        if re.search(p, T):
            im8_score += 2

    # -------------------------------------------------
    # 6️⃣ DECISION PAR SCORE
    # -------------------------------------------------
    log.debug(
        "classify_document.scores",
        extra={"bl_score": bl_score, "im8_score": im8_score},
    )

    if bl_score >= 3 and bl_score > im8_score:
        return "BL"

    if im8_score >= 3 and im8_score > bl_score:
        return "IM8"

    # -------------------------------------------------
    # 7️⃣ FALLBACK FILENAME / URL (faible confiance)
    # -------------------------------------------------
    lower = (text_or_filename or "").lower()

    if any(x in lower for x in (
        "bill_of_lading",
        "bill-of-lading",
        "_bl",
        "/bl/",
        "b_l",
    )):
        return "BL"

    if "im8" in lower:
        return "IM8"

    return "UNKNOWN"
