import re
from typing import List, Dict, Any

from services.bl_parser import is_iso6346


def _near_keyword_signal(text: str, candidate: str, keywords: List[str], window: int = 80) -> bool:
    """Return True if any keyword appears within `window` chars of candidate."""
    if not text or not candidate:
        return False
    T = text.upper()
    tok = candidate.upper()
    idx = T.find(tok)
    if idx == -1:
        return False
    start = max(0, idx - window)
    end = min(len(T), idx + len(tok) + window)
    ctx = T[start:end]
    for k in keywords:
        if k.upper() in ctx:
            return True
    return False


def confidence_trace(text: str, candidate: str, keywords: List[str]) -> Dict[str, Any]:
    """Compute an explainable confidence trace for a BL candidate.

    Returns a dict with `value`, `score` (0..1) and `signals` map.
    """
    signals: Dict[str, Any] = {
        'has_digits': False,
        'length_ok': False,
        'near_bl_label': False,
        'looks_like_container': False,
        'near_seal_or_booking': False,
        'ocr_fragmented': False,
        'frequency': 0,
    }

    if not candidate or not text:
        return {'value': candidate, 'score': 0.0, 'signals': signals}

    raw = text or ''
    tok = ''.join(ch for ch in candidate.upper() if ch.isalnum())

    # Signals
    signals['has_digits'] = any(c.isdigit() for c in tok)
    signals['length_ok'] = 6 <= len(tok) <= 20
    signals['looks_like_container'] = bool(re.match(r'^[A-Z]{4}\d{7}$', tok)) or is_iso6346(tok)
    # near BL label
    signals['near_bl_label'] = _near_keyword_signal(raw, candidate, keywords, window=100)
    # near SEAL or BOOKING
    signals['near_seal_or_booking'] = _near_keyword_signal(raw, candidate, ['SEAL', 'SEAL NO', 'BOOKING', 'BOOKING NO'], window=80)
    # frequency (occurrences of exact token)
    signals['frequency'] = raw.count(candidate)

    # ocr_fragmented: look for spaced form in raw (e.g., 'M E D U 9 0 2')
    spaced_pattern = r"\b(?:%s)\b" % ('\s+'.join(list(candidate)))
    try:
        signals['ocr_fragmented'] = bool(re.search(spaced_pattern, raw, flags=re.IGNORECASE))
    except Exception:
        signals['ocr_fragmented'] = False

    # Scoring heuristics (conservative): start 0, add positive signals, subtract penalties
    score = 0.0

    # mandatory: must have digits and reasonable length
    if not signals['has_digits'] or not signals['length_ok']:
        return {'value': candidate, 'score': 0.0, 'signals': signals}

    # base for structure
    score += 0.15

    # proximity to explicit BL label is strong signal
    if signals['near_bl_label']:
        score += 0.45

    # frequency bonus
    if signals['frequency'] >= 2:
        score += 0.1

    # OCR fragmented small bonus (helps recover spaced tokens)
    if signals['ocr_fragmented']:
        score += 0.05

    # length ideal bonus
    if 8 <= len(tok) <= 20:
        score += 0.15

    # Penalties
    if signals['looks_like_container']:
        # containers must not be considered BL
        return {'value': candidate, 'score': 0.0, 'signals': signals}

    if signals['near_seal_or_booking'] and not signals['near_bl_label']:
        score -= 0.4

    # clamp
    score = max(0.0, min(1.0, score))

    return {'value': candidate, 'score': round(score, 3), 'signals': signals}


def final_confidence(text: str, candidate: str, keywords: List[str]) -> float:
    """Backward-compatible API returning a float confidence while producing
    an explainable trace via logs.
    """
    trace = confidence_trace(text, candidate, keywords)
    # log structured trace for observability (caller can also log)
    try:
        from core.logging import get_logger

        get_logger().info('BL_CONFIDENCE_TRACE', extra={'trace': trace})
    except Exception:
        pass

    return float(trace.get('score', 0.0))
