# services/ocr_service.py
import io
import logging
from typing import Optional, List

import requests
from PIL import Image, ImageOps
import pytesseract
from pdf2image import convert_from_bytes
from PyPDF2 import PdfReader

from core.logging import get_logger

logger = logging.getLogger(__name__)

# -------------------------------------------------
# OCR IMAGE CORE
# -------------------------------------------------
def _ocr_image(img: Image.Image) -> str:
    log = get_logger()
    log.debug("ocr_image.start")

    texts: List[str] = []

    # 1️⃣ Pré-traitement robuste
    try:
        img = img.convert("L")
        img = ImageOps.autocontrast(img)
    except Exception:
        pass

    # ⚠️ BL = texte structuré → éviter PSM trop agressifs
    psm_list = [6, 4, 3]  # 6 = bloc, 4 = colonne, 3 = auto

    for psm in psm_list:
        try:
            config = (
                f"-l eng+fra "
                f"--oem 3 "
                f"--psm {psm} "
                f"-c preserve_interword_spaces=1 "
                f"--dpi 300"
            )
            txt = pytesseract.image_to_string(img, config=config)
            if txt and len(txt.strip()) > 20:
                texts.append(txt)
                log.debug("ocr_image.psm", extra={"psm": psm, "len": len(txt)})
        except Exception:
            pass

    # 2️⃣ Fallback binarisé (en dernier recours)
    try:
        bw = img.point(lambda x: 0 if x < 160 else 255, "1")
        for psm in psm_list:
            try:
                config = f"-l eng+fra --oem 3 --psm {psm} --dpi 300"
                txt = pytesseract.image_to_string(bw, config=config)
                if txt and len(txt.strip()) > 20:
                    texts.append(txt)
            except Exception:
                pass
    except Exception:
        pass

    # 👉 on retourne le texte le plus long (meilleure couverture)
    return max(texts, key=len) if texts else ""


# -------------------------------------------------
# PDF OCR
# -------------------------------------------------
def _extract_text_from_pdf_bytes(pdf_bytes: bytes) -> str:
    log = get_logger()

    # 1️⃣ PDF SEARCHABLE (prioritaire)
    try:
        reader = PdfReader(io.BytesIO(pdf_bytes))
        pages_text = []
        for page in reader.pages:
            t = page.extract_text() or ""
            if t.strip():
                pages_text.append(t)

        joined = "\n".join(pages_text).strip()
        if len(joined) > 50:
            log.debug("pdf.searchable.success", extra={"len": len(joined)})
            return joined
    except Exception:
        log.debug("pdf.searchable.failed", exc_info=True)

    # 2️⃣ OCR IMAGE (fallback)
    try:
        log.info("pdf.image_ocr.start", extra={"bytes": len(pdf_bytes)})
        images = convert_from_bytes(
            pdf_bytes,
            dpi=300,
            fmt="png",
            thread_count=2,
        )

        ocr_texts = []
        for i, img in enumerate(images):
            t = _ocr_image(img)
            if t:
                ocr_texts.append(t)
            log.debug("pdf.image_ocr.page", extra={"page": i + 1, "len": len(t)})

        joined = "\n".join(ocr_texts)
        log.info(
            "pdf.image_ocr.done",
            extra={"pages": len(images), "text_len": len(joined)},
        )
        return joined
    except Exception:
        log.exception("pdf.image_ocr.failed")
        return ""


# -------------------------------------------------
# PUBLIC API
# -------------------------------------------------
def ocr_from_bytes(data: bytes, content_type: Optional[str] = None) -> str:
    """
    Perform OCR on in-memory bytes.
    Returns NORMALIZED text (UPPERCASE, collapsed spaces).
    """
    raw_text = ""

    try:
        is_pdf = (
            (content_type and "pdf" in content_type.lower())
            or data[:4] == b"%PDF"
        )

        if is_pdf:
            raw_text = _extract_text_from_pdf_bytes(data)
        else:
            img = Image.open(io.BytesIO(data))
            raw_text = _ocr_image(img)

    except Exception:
        logger.exception("ocr_from_bytes.failed")
        raw_text = ""

    # 3️⃣ NORMALISATION CRITIQUE POUR BL
    normalized = (
        raw_text.replace("\r", " ")
        .replace("\n", " ")
        .replace("\t", " ")
    )
    normalized = " ".join(normalized.split()).upper()

    get_logger().info(
        "ocr_from_bytes.result",
        extra={"len_raw": len(raw_text), "len_norm": len(normalized)},
    )
    return normalized


def ocr_from_url(url: str) -> str:
    """Download URL and run OCR."""
    try:
        resp = requests.get(url, timeout=20)
        resp.raise_for_status()
        return ocr_from_bytes(
            resp.content,
            content_type=resp.headers.get("content-type", ""),
        )
    except Exception:
        get_logger().exception("ocr_from_url.failed", extra={"url": url})
        return ""
