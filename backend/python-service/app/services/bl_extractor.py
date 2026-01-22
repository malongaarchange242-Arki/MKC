"""BL extraction utilities.

Dependencies (install in environment):
  pip install pytesseract pdfplumber pdf2image pillow regex

This module provides a single entrypoint `extract_bl_reference(file_bytes, document_type)`
which returns a dict with keys: bl, normalized, carrier, score, matches, ocr_text_snippet,
is_scanned, method, warnings

Design/heuristics summary:
- Only run OCR when caller indicates `document_type` is BILL_OF_LADING.
- Detect if PDF is scanned by attempting text extraction with `pdfplumber` first.
- If text extraction yields negligible text, convert pages to images and run Tesseract OCR.
- Use robust regexes for MAEU (Maersk) and MEDU (MSC) and fallback generic patterns.
- Score matches using pattern specificity, textual context (near "Bill of Lading"),
  and OCR confidence when available.
"""
from typing import Optional, List, Dict, Tuple
import io
import re
import statistics

try:
    import pdfplumber
except Exception:
    pdfplumber = None

try:
    from pdf2image import convert_from_bytes
except Exception:
    convert_from_bytes = None

try:
    from PIL import Image
except Exception:
    Image = None

try:
    import pytesseract
except Exception:
    pytesseract = None


_MAERSK_RE = re.compile(r"\b(?:MAEU)?\s*([0-9]{6,10})\b", re.IGNORECASE)
_MSC_RE = re.compile(r"\b(MEDU)[-\s]*([A-Z0-9]{7})\b", re.IGNORECASE)
# Generic: words like B/L No., Bill of Lading No, BL No followed by an identifier
_GENERIC_BL_RE = re.compile(r"\b(?:B/?L(?:\s|\.|\:)?|Bill(?: of)? Lading(?: No\.?| No|)\s*[:\-]?|BILL\. NO\.?|B\.?L\.?)\s*([A-Z0-9\-\/]{6,20})\b", re.IGNORECASE)


def _safe_pdf_text_extract(file_bytes: bytes, max_pages: int = 5) -> str:
    if not pdfplumber:
        return ''
    txt_parts = []
    try:
        with pdfplumber.open(io.BytesIO(file_bytes)) as pdf:
            for i, page in enumerate(pdf.pages):
                if i >= max_pages:
                    break
                try:
                    ptxt = page.extract_text() or ''
                except Exception:
                    ptxt = ''
                txt_parts.append(ptxt)
    except Exception:
        return ''
    return '\n'.join(txt_parts)


def _is_scanned_pdf(text: str, threshold_chars: int = 50) -> bool:
    # If extracted text is very short, treat as scanned
    if not text:
        return True
    # Count meaningful characters (letters/digits)
    meaningful = re.sub(r'[^A-Za-z0-9]', '', text)
    return len(meaningful) < threshold_chars


def _ocr_images_from_pdf(file_bytes: bytes, dpi: int = 300, max_pages: int = 5) -> Tuple[str, Optional[float]]:
    # Returns full concatenated OCR text and approximate mean confidence (0-100) if available
    if not (convert_from_bytes and pytesseract and Image):
        raise RuntimeError('Missing OCR dependencies (pdf2image/pytesseract/Pillow)')
    imgs = convert_from_bytes(file_bytes, dpi=dpi)
    texts = []
    confidences = []
    for i, img in enumerate(imgs):
        if i >= max_pages:
            break
        try:
            # pytesseract.image_to_data returns confidences per block
            data = pytesseract.image_to_data(img, output_type=pytesseract.Output.DICT)
            page_text = []
            page_conf = []
            for j, txt in enumerate(data.get('text', [])):
                t = (txt or '').strip()
                if not t:
                    continue
                page_text.append(t)
                try:
                    conf = float(data.get('conf', [])[j])
                    if conf >= 0:
                        page_conf.append(conf)
                except Exception:
                    pass
            if page_text:
                texts.append(' '.join(page_text))
            if page_conf:
                confidences.extend(page_conf)
        except Exception:
            continue
    full = '\n'.join(texts)
    mean_conf = float(statistics.mean(confidences)) if confidences else None
    return full, mean_conf


def _find_bl_patterns(text: str) -> List[Dict]:
    results = []
    for m in _MSC_RE.finditer(text):
        carrier = 'MSC'
        full = (m.group(1) + m.group(2)).upper()
        results.append({'carrier': carrier, 'match': full, 'span': m.span()})
    for m in _MAERSK_RE.finditer(text):
        # Heuristic: if group includes MAEU prefix already, keep it, else only digits
        digits = m.group(1)
        # Accept as Maersk if digits length plausible
        if len(digits) >= 6:
            carrier = 'MAERSK'
            full = digits
            results.append({'carrier': carrier, 'match': full, 'span': m.span()})
    # Generic fallback
    for m in _GENERIC_BL_RE.finditer(text):
        candidate = m.group(1)
        results.append({'carrier': None, 'match': candidate, 'span': m.span()})
    return results


def _normalize_bl(match: str, carrier: Optional[str]) -> str:
    s = re.sub(r'[^A-Za-z0-9]', '', match).upper()
    if carrier == 'MSC':
        # Ensure prefix MEDU exists
        if not s.startswith('MEDU') and len(s) == 7:
            s = 'MEDU' + s
    if carrier == 'MAERSK':
        # Maersk often just digits; keep digits
        s = s
    return s


def _score_candidate(candidate: Dict, text: str, mean_conf: Optional[float]) -> float:
    # Base score by specificity
    score = 0.0
    carrier = candidate.get('carrier')
    match = candidate.get('match', '')
    span = candidate.get('span')
    if carrier == 'MSC':
        score += 0.55
    elif carrier == 'MAERSK':
        score += 0.45
    else:
        score += 0.25

    # If appears near 'BILL' or 'B/L' keywords, boost
    window_start = max(0, span[0] - 80)
    window_end = min(len(text), span[1] + 80)
    context = text[window_start:window_end].lower()
    if 'bill' in context or 'b/l' in context or 'bill of lading' in context:
        score += 0.2

    # Confidence from OCR improves score
    if mean_conf is not None:
        # Map conf 0-100 to 0-0.25
        score += min(0.25, (mean_conf / 100.0) * 0.25)

    # Normalize to 0-1
    return min(1.0, score)


def extract_bl_reference(file_bytes: bytes, document_type: str) -> Dict:
    """Main entrypoint.

    document_type: expected value like 'BILL_OF_LADING' or other constants from frontend.
    Returns a dict with keys:
      - bl: raw matched string or None
      - normalized: normalized BL string (MEDU..., digits, etc.) or None
      - carrier: 'MSC'|'MAERSK'|None
      - score: float 0..1
      - matches: list of raw matches found
      - ocr_text_snippet: short snippet
      - is_scanned: bool
      - method: 'text-extract'|'ocr'|'none'
      - warnings: list[str]
    """
    result = {
        'bl': None,
        'normalized': None,
        'carrier': None,
        'score': 0.0,
        'matches': [],
        'ocr_text_snippet': '',
        'is_scanned': False,
        'method': 'none',
        'warnings': []
    }

    if not document_type or str(document_type).strip().upper() != 'BILL_OF_LADING':
        result['warnings'].append('Skip OCR: document_type != BILL_OF_LADING')
        return result

    # 1) Try fast text extraction
    text = _safe_pdf_text_extract(file_bytes)
    is_scanned = _is_scanned_pdf(text)
    result['is_scanned'] = is_scanned

    mean_conf = None
    method = 'text-extract'
    ocr_text = text or ''

    if is_scanned:
        method = 'ocr'
        try:
            ocr_text, mean_conf = _ocr_images_from_pdf(file_bytes)
        except Exception as e:
            result['warnings'].append(f'OCR failure: {e}')
            ocr_text = ''

    result['method'] = method
    result['ocr_text_snippet'] = (ocr_text or text or '')[:1000]

    # 2) Find BL patterns
    search_text = (ocr_text or text or '')
    candidates = _find_bl_patterns(search_text)
    result['matches'] = [c['match'] for c in candidates]

    if not candidates:
        return result

    # Score and pick best
    scored = []
    for c in candidates:
        s = _score_candidate(c, search_text, mean_conf)
        scored.append((s, c))
    scored.sort(key=lambda x: x[0], reverse=True)
    top_score, top_cand = scored[0]

    normalized = _normalize_bl(top_cand['match'], top_cand.get('carrier'))
    result.update({
        'bl': top_cand['match'],
        'normalized': normalized,
        'carrier': top_cand.get('carrier'),
        'score': round(float(top_score), 3)
    })

    return result


if __name__ == '__main__':
    # Quick regex sanity checks using representative strings
    tests = [
        ('MAEU123456789', 'MAERSK example'),
        ('MEDU9024256', 'MSC example'),
        ('B/L No. 262267475', 'Generic Maersk numeric example'),
    ]
    for t, desc in tests:
        print(desc, '->', _find_bl_patterns(t))
