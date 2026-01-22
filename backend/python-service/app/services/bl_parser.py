# services/bl_parser.py
import re
from typing import List, Optional
from core.logging import get_logger

log = get_logger()

# =========================
# BL CONTEXT DETECTION
# =========================

def looks_like_bl(text: str) -> bool:
    if not text:
        return False

    T = text.lower()

    patterns = [
        r"bill\s*of\s*lading",  # Normal spacing
        r"billoflading",  # Compacted from OCR-spaced text (B I L L   O F   L A D I N G)
        r"b\s*[/|]?\s*l",
        r"bl\s*(no|number)?",
        r"blno",  # Compacted BL NO
        r"ocean\s*bill",
        r"oceanbill",  # Compacted
        r"house\s*bill",
        r"housebill",  # Compacted
        r"master\s*bill",
        r"masterbill",  # Compacted
    ]

    return any(re.search(p, T) for p in patterns)


# =========================
# BL EXTRACTION
# =========================

BL_REGEXES = [
    # ========================================
    # PATTERNS EXPLICITES (avec labels) - PRIORITÉ HAUTE
    # ========================================
    # B/L NO., BL NO., B/L NUMBER, etc. (avec tous les séparateurs possibles)
    r"B[/\-]?L\s*(?:NO|NUMBER|NUM|REF|REFERENCE)[:\-\.\s]*([A-Z0-9\-_/]{6,25})",
    
    # BILL OF LADING NO., NUMBER, etc.
    r"BILL\s+OF\s+LADING\s*(?:NO|NUMBER|NUM|REF|REFERENCE)[:\-\.\s]*([A-Z0-9\-_/]{6,25})",
    r"BILLOFLADING\s*(?:NO|NUMBER|NUM|REF|REFERENCE)[:\-\.\s]*([A-Z0-9\-_/]{6,25})",  # Compacted
    
    # OCEAN BILL, HOUSE BILL, MASTER BILL
    r"(?:OCEAN|HOUSE|MASTER)\s+BILL\s*(?:NO|NUMBER|NUM)[:\-\.\s]*([A-Z0-9\-_/]{6,25})",
    r"(?:OCEAN|HOUSE|MASTER)BILL\s*(?:NO|NUMBER|NUM)[:\-\.\s]*([A-Z0-9\-_/]{6,25})",  # Compacted
    
    # BL NO: (compacted variants)
    r"BLNO[:\-\.\s]*([A-Z0-9\-_/]{6,25})",
    r"BL\s*NO[:\-\.\s]*([A-Z0-9\-_/]{6,25})",
    
    # BL REF:, BL REFERENCE:
    r"BL\s+REF(?:ERENCE)?[:\-\.\s]+([A-Z0-9\-_/]{6,25})",
    
    # ========================================
    # PATTERNS DE FORMAT (sans label explicite) - PRIORITÉ MOYENNE
    # ========================================
    # Format standard : 2-4 lettres + 6-15 chiffres (CMAU1234567, EID0911671)
    r"\b[A-Z]{2,4}\d{6,15}\b",
        # More permissive pattern: 3-4 letters followed by 6+ alphanumeric (covers variants like MEDU1234567, MAEU1234A67)
        r"\b[A-Z]{3,4}[A-Z0-9]{6,20}\b",
    
    # Format avec préfixe numérique : 1-2 chiffres + 2-4 lettres + 6-15 chiffres (00LU2164215810)
    r"\b\d{1,2}[A-Z]{2,4}\d{6,15}\b",
    
    # Format avec tirets/slashes dans le numéro : MAEU-1234567, CMAU/1234567
    r"\b[A-Z]{2,4}[\-/_]\d{6,15}\b",
    r"\b\d{1,2}[A-Z]{2,4}[\-/_]\d{6,15}\b",
    
    # Format purement numérique (8-15 chiffres) - seulement si contexte BL
    # Note: Ce pattern est moins spécifique, sera filtré par is_false_positive si hors contexte
    r"\b\d{8,15}\b",
]

# Split regex sets: first block are explicit labelled patterns, remainder are format/fallback patterns
EXPLICIT_BL_REGEXES = BL_REGEXES[:8]


def _clean(c: str) -> str:
    return re.sub(r"[^A-Z0-9]", "", c.upper())


def extract_bl_numbers(text: str, only_explicit: bool = False) -> List[str]:
    found = []
    seen = set()
    log.info('extract_bl_numbers.start', extra={'text_len': len(text or '')})
    regexes = EXPLICIT_BL_REGEXES if only_explicit else BL_REGEXES
    for rx in regexes:
        for m in re.findall(rx, text or "", flags=re.IGNORECASE):
            val = m[-1] if isinstance(m, tuple) else m
            if not val:
                continue
            v = _clean(val)
            # Ignore obvious container numbers (ISO 6346) so we don't mistake
            # them for BL numbers
            if is_iso6346(v):
                log.info('extract_bl_numbers.container_like', extra={'value': v})
                # do not hard-reject here; leave decision to scoring

            # Skip if the token appears inside a container-list section
            if is_within_container_section(text, v):
                log.info('extract_bl_numbers.within_container_section', extra={'value': v})
                # do not hard-reject here; leave decision to scoring

            # structural and false-positive filter
            if is_structurally_invalid_bl(v):
                log.info('extract_bl_numbers.filtered_structural', extra={'value': v})
                continue
            if is_false_positive(v):
                log.info('extract_bl_numbers.filtered_false_positive', extra={'value': v})
                continue
            if 6 <= len(v) <= 20 and v not in seen:
                seen.add(v)
                found.append(v)

    log.info('extract_bl_numbers.found', extra={'count': len(found), 'samples': found[:5]})
    return found


# =========================
# FALLBACK CANDIDATES
# =========================

def extract_bl_candidates(text: str) -> List[str]:
    candidates = []
    # text must be normalized by the caller; do not re-normalize here
    for m in re.finditer(r"\b[A-Z0-9\-_/]{6,20}\b", text or "", flags=re.IGNORECASE):
        c = _clean(m.group(0))
        if 6 <= len(c) <= 20:
            # structural filter: skip obvious non-BL tokens
            if is_structurally_invalid_bl(c):
                log.info('extract_bl_candidates.filtered_structural', extra={'value': c})
                continue
            if is_false_positive(c):
                log.info('extract_bl_candidates.filtered_false_positive', extra={'value': c})
                continue
            candidates.append(c)

    seen = set()
    return [c for c in candidates if not (c in seen or seen.add(c))]


def is_false_positive(c: str) -> bool:
    """
    Filter out obvious false positives that match BL number patterns but are clearly not BL numbers.
    
    Common false positives:
    - Dates (YYYY, YYMMDD)
    - Short numeric codes
    - Very long numeric strings
    """
    if not c:
        return True
    
    # Too short to be a BL number
    if len(c) < 6:
        return True
    
    # Dates: 4-digit years (1900-2099)
    if re.match(r'^(19|20)\d{2}$', c):
        return True
    
    # Dates: 6-digit dates (YYMMDD, MMDDYY patterns - very common false positive)
    if c.isdigit() and len(c) == 6:
        # Check if it looks like a date (first 2 digits <= 31 or last 2 digits <= 31)
        try:
            if int(c[:2]) <= 31 or int(c[-2:]) <= 31:
                return True
        except ValueError:
            pass
    
    # Very long purely numeric strings (likely not BL numbers, often phone/account numbers)
    if c.isdigit() and len(c) > 15:
        return True
    
    return False


# -------------------------
# OCR reconstruction & scoring helpers
# -------------------------
def _ocr_reconstruct(text: str) -> str:
    """
    Conservative OCR reconstruction:
    - Join short broken lines likely split by OCR
    - Collapse spaces between digits
    - Remove intrusive punctuation inside tokens
    """
    if not text:
        return ''

    s = text.replace('\r', '\n')
    lines = s.split('\n')
    out_lines = []
    i = 0
    while i < len(lines):
        ln = lines[i].strip()
        if i + 1 < len(lines):
            nxt = lines[i+1].strip()
            if ln and nxt and len(ln) <= 4 and len(nxt) <= 6 and re.match(r'^[A-Za-z0-9\-_/]+$', ln) and re.match(r'^[A-Za-z0-9\-_/]+$', nxt):
                out_lines.append(ln + nxt)
                i += 2
                continue
        out_lines.append(ln)
        i += 1

    s2 = ' '.join([l for l in out_lines if l])
    s2 = re.sub(r'(?<=\d)\s+(?=\d)', '', s2)
    s2 = re.sub(r'(?<=[A-Za-z0-9])[\.,](?=[A-Za-z0-9])', '', s2)
    s2 = re.sub(r'[-]{2,}', '-', s2)
    s2 = re.sub(r'[/]{2,}', '/', s2)
    return s2


def _generate_candidates(text: str, min_len: int = 6, max_len: int = 20) -> List[str]:
    """
    Permissive candidate extraction: tokens of letters/digits and -_/ chars.
    Returns unique uppercase tokens filtered by normalized length.
    """
    if not text:
        return []
    token_rx = re.compile(r"[A-Za-z0-9][A-Za-z0-9\-_/]{%d,%d}" % (min_len-1, max_len-1))
    seen = set(); out = []
    for m in token_rx.finditer(text):
        tok = m.group(0).upper().strip('-_/')
        tok = re.sub(r'[^A-Z0-9\-_/]', '', tok)
        norm = re.sub(r'[^A-Z0-9]', '', tok)
        if not (min_len <= len(norm) <= max_len):
            continue
        if tok in seen:
            continue
        seen.add(tok); out.append(tok)
    return out


def _detect_context_score(text: str, token: str) -> int:
    """Score proximity to BL keywords (explainable buckets)."""
    score = 0
    if not text or not token:
        return 0
    T = text.upper(); token_u = token.upper()
    pos = T.find(token_u)
    if pos == -1:
        return 0
    window = T[max(0, pos-80): pos + len(token_u) + 80]
    if re.search(r'\bB\s*[/\\-]?\s*L\b|BILL\s+OF\s+LADING|BL\s*(NO|NUMBER|REF|REFERENCE)', window):
        score += 60
    elif re.search(r'\bBL\s+REF|REFERENCE|REF\b', window):
        score += 30
    if re.search(r'\bBILL\s+OF\s+LADING|B\/L|OCEAN\s+BILL|HOUSE\s+BILL', T):
        score += 15
    return score


def _score_candidate(token: str, text: str) -> (float, List[str]):
    """Explainable scoring for a candidate token."""
    reasons = []; base = 0.0
    raw = re.sub(r'[^A-Z0-9]', '', token.upper()); L = len(raw)
    if 6 <= L <= 12:
        base += 0.20; reasons.append('valid_length')
    elif 13 <= L <= 20:
        base += 0.05; reasons.append('long_but_possible')
    else:
        reasons.append('invalid_length')
    has_alpha = bool(re.search(r'[A-Z]', raw)); has_digit = bool(re.search(r'\d', raw))
    if has_alpha and has_digit:
        base += 0.20; reasons.append('alpha_numeric')
    elif has_digit and not has_alpha:
        base += 0.05; reasons.append('numeric_only')
    else:
        reasons.append('alpha_only')
    try:
        if is_iso6346(raw):
            reasons.append('is_container_number'); return 0.0, reasons
    except Exception:
        pass
    # local weight/seal penalty
    txt_up = text.upper()
    idx = txt_up.find(token.upper())
    local = txt_up[max(0, idx-40): idx + len(token) + 40] if idx != -1 else ''
    if re.search(r'\bKG\b|\bKGS\b|\bTONS?\b|\bWEIGHT\b|\bSEAL\b', local):
        reasons.append('near_weight_or_seal'); base -= 0.4
    ctx = _detect_context_score(text, token)
    if ctx >= 60: reasons.append('near_bl_keyword')
    elif ctx >= 30: reasons.append('near_bl_reference')
    base += (ctx / 200.0)
    occurrences = len(re.findall(re.escape(token), text, flags=re.IGNORECASE))
    if occurrences == 1:
        base += 0.10; reasons.append('unique')
    else:
        base -= min(0.1, 0.02 * (occurrences - 1)); reasons.append(f'occurrences:{occurrences}')
    score = max(0.0, min(1.0, base))
    reasons.append(f'raw_len={L}')
    return score, reasons



def extract_containers(text: str) -> List[str]:
    """Extract container numbers like HASU5143253 or MSKU1234567."""
    containers = []
    # ISO container: 4 letters + 7 digits (validate check digit)
    for m in re.finditer(r'\b([A-Z]{4}\d{7})\b', text or '', flags=re.IGNORECASE):
        cand = m.group(1).upper()
        if is_iso6346(cand):
            containers.append(cand)
        else:
            log.info('extract_containers.invalid_iso', extra={'candidate': cand})

    # fallback patterns e.g. HASU5143253 or with separators - validate ISO6346
    for m in re.finditer(r'\b([A-Z0-9]{4,12}[-_ ]?[0-9]{4,8})\b', text or '', flags=re.IGNORECASE):
        c = m.group(1).replace(' ', '').replace('-', '').replace('_', '').upper()
        # prefer ISO-validated containers only
        if len(c) == 11 and is_iso6346(c):
            containers.append(c)

    # dedupe preserve order
    seen = set(); out = []
    for c in containers:
        if c not in seen:
            seen.add(c); out.append(c)

    log.info('extract_containers.found', extra={'count': len(out), 'samples': out[:5]})
    return out


def is_within_container_section(text: str, token: str, lookback: int = 200) -> bool:
    """Return True if token occurs in a region likely labeled as container numbers.

    We search backwards from the token occurrence up to `lookback` characters to
    find headings like 'container', 'container numbers', 'container no', etc.
    """
    idx = (text or '').find(token)
    if idx == -1:
        return False
    start = max(0, idx - lookback)
    context = (text or '')[start:idx].lower()
    indicators = ['container', 'container no', 'container numbers', 'container nos', 'containers']
    return any(ind in context for ind in indicators)


def is_iso6346(c: str) -> bool:
    """Validate an ISO 6346 container number (4 letters + 7 digits with check digit).

    Algorithm:
    - Map letters to values per ISO 6346
    - For the first 10 characters (letters/digits excluding check digit), multiply
      each value by 2**position where position starts at 0 for the leftmost char
    - Sum the products, compute remainder mod 11; check digit = remainder; if 10 -> 0
    """
    if not c or len(c) != 11:
        return False
    m = re.match(r'^([A-Z]{4})(\d{6})(\d)$', c)
    if not m:
        return False
    owner = m.group(1)
    serial = m.group(2)
    check_digit = int(m.group(3))

    # Letter mapping per ISO 6346
    letter_map = {
        'A':10,'B':12,'C':13,'D':14,'E':15,'F':16,'G':17,'H':18,'I':19,'J':20,
        'K':21,'L':23,'M':24,'N':25,'O':26,'P':27,'Q':28,'R':29,'S':30,'T':31,
        'U':32,'V':34,'W':35,'X':36,'Y':37,'Z':38
    }

    values = []
    for ch in owner:
        if ch not in letter_map:
            return False
        values.append(letter_map[ch])
    for ch in serial:
        values.append(int(ch))

    total = 0
    for i, val in enumerate(values):
        weight = 2 ** i
        total += val * weight

    remainder = total % 11
    computed = remainder if remainder != 10 else 0
    return computed == check_digit


def has_explicit_bl_label_near(text: str, token: str, window: int = 80) -> bool:
    T = (text or '').upper()
    tok = token.upper()
    idx = T.find(tok)
    if idx == -1:
        return False

    start = max(0, idx - window)
    end = min(len(T), idx + len(tok) + window)
    context = T[start:end]

    # ⚠️ UNIQUEMENT les labels BL légitimes
    labels = [
        "BILL OF LADING",
        "B/L",
        "BL NO",
        "BL NUMBER",
        "BLNO",
        "OCEAN BILL",
        "HOUSE BILL",
        "MASTER BILL",
    ]

    return any(lbl in context for lbl in labels)


def is_in_forbidden_bl_context(text: str, token: str, window: int = 80) -> bool:
    T = (text or '').upper()
    tok = token.upper()
    idx = T.find(tok)
    if idx == -1:
        return False

    start = max(0, idx - window)
    context = T[start:idx]

    forbidden = [
        "SEAL",
        "SEAL NO",
        "CARRIER",
        "CARRIER SEAL",
        "CONTAINER",
        "BOOKING",
        "IMO",
        "VOYAGE",
    ]

    return any(f in context for f in forbidden)


def is_seal_number_context(text: str, token: str, window: int = 80) -> bool:
    T = (text or '').upper()
    tok = token.upper()
    idx = T.find(tok)
    if idx == -1:
        return False
    context = T[max(0, idx - window): idx + window]
    return any(k in context for k in [
        'SEAL',
        'SEAL NUMBER',
        'CARRIER',
        'CONTAINER NUMBERS'
    ])


def is_tax_or_fiscal_context(text: str, token: str, window: int = 80) -> bool:
    T = (text or '').upper()
    tok = token.upper()
    idx = T.find(tok)
    if idx == -1:
        return False

    context = T[max(0, idx - window): idx + window]

    forbidden = [
        'TAX ID',
        'VAT',
        'NIF',
        'TIN',
        'FISCAL',
        'CUSTOMER CODE',
        'REGISTRATION NO',
    ]

    return any(f in context for f in forbidden)


def is_in_port_or_voyage_context(text: str, token: str, window: int = 80) -> bool:
    """Return True if token appears near port/voyage labels (false positive context)."""
    if not text or not token:
        return False
    
    T = text.upper()
    tok = token.upper()
    idx = T.find(tok)
    if idx == -1:
        return False
    
    # Check context before the token
    start = max(0, idx - window)
    context = T[start:idx]
    
    # Forbidden contexts (port, voyage, vessel identifiers)
    forbidden = [
        'PORT OF LOADING',
        'PORT OF DISCHARGE',
        'VOYAGE NO',
        'VESSEL',
        'IMO NO',
        'SERVICE CONTRACT',
        'SVC CONTRACT',
    ]
    
    return any(f in context for f in forbidden)


def extract_seals(text: str) -> List[str]:
    """Extract seal numbers with common prefixes or adjacent to the word 'Seal'."""
    seals = []
    for m in re.finditer(r'\bSEAL\b[:#\-\s]*([A-Z0-9\-_/]{3,20})', text or '', flags=re.IGNORECASE):
        seals.append(m.group(1).upper())

    # generic tokens that may be seals — only accept if surrounding context suggests a Seal
    for m in re.finditer(r'\b([A-Z]{2,4}[-_]?[A-Z0-9]{4,12})\b', text or '', flags=re.IGNORECASE):
        token = m.group(1).upper()
        if is_seal_number_context(text, token):
            seals.append(token)

    seen = set(); out = []
    for s in seals:
        if s not in seen:
            seen.add(s); out.append(s)

    log.info('extract_seals.found', extra={'count': len(out), 'samples': out[:5]})
    return out


def extract_weight(text: str) -> Optional[str]:
    # match patterns like '18000.000 KGS' or '18,000 KGS' or '18000 KGS'
    m = re.search(r'([0-9]{1,3}(?:[0-9\,\.\s]{0,15})?)\s*(KGS|KG|KILOGRAMS?)', text or '', flags=re.IGNORECASE)
    if m:
        return m.group(0).replace('\n', ' ').strip()
    for line in (text or '').split('\n'):
        if 'KGS' in line.upper() or 'KG' in line.upper():
            if re.search(r'[0-9]', line):
                return line.strip()
    log.info('extract_weight.found', extra={'value': m.group(0).replace('\n', ' ').strip()}) if m else log.info('extract_weight.none')
    return None


import re
from typing import Optional

# ===================== CONSTANTES =====================

BLACKLIST = {'RECEIVED', 'COPY', 'DRAFT', 'ORIGINAL', 'SIGNED', 'PAGE', 'PAGES'}

DRAFT_CONTEXT = [
    'VERIFY COPY',
    'DRAFT BILL',
    'NOT FINAL',
    'FINAL B/L WILL BE READY',
    'FINAL BL WILL BE READY',
    'PRECONDITION',
    'PRECONDITIONS',
]

BL_LABELS = [
    'BILL OF LADING NUMBER',
    'BILL OF LADING NO',
    'B/L NO',
    'BL NO',
]

BOOKING_LABELS = [
    'BOOKING NO',
    'BOOKING NUMBER',
]

MIN_SCORE = 45
MIN_MARGIN = 5


# ===================== FONCTION PRINCIPALE =====================

def candidate_near_phrase(text: str, token: str, phrase: str, window: int = 60) -> bool:
    """Return True if `phrase` occurs within `window` chars of `token` in `text`."""
    if not text or not token or not phrase:
        return False
    T = (text or '').upper()
    tok = token.upper()
    ph = phrase.upper()
    idx = T.find(tok)
    if idx == -1:
        return False
    start = max(0, idx - window)
    end = min(len(T), idx + len(tok) + window)
    context = T[start:end]
    return ph in context


def is_structurally_invalid_bl(token: str) -> bool:
    """Return True if `token` is structurally invalid as a BL number.

    Rules (enforced before scoring):
    - Must contain at least one digit
    - Must contain both letters and digits (no 100% alphabetic tokens)
    - Length must be between 6 and 20 (inclusive)
    - Reject a small set of known non-BL words (RECEIVED, COPY, DRAFT, ORIGINAL, NONNEGOTIABLE, BL)
    """
    if not token:
        return True

    # normalize (keep only letters+digits for structural checks)
    t = re.sub(r'[^A-Z0-9]', '', token.upper())

    # length check
    if len(t) < 6 or len(t) > 20:
        return True

    # must contain at least one digit
    if not any(ch.isdigit() for ch in t):
        return True

    # allow purely-numeric tokens as potential BLs (Maersk-like cases)
    # but only keep numeric tokens if length between 8 and 15; further
    # validation (explicit label/proximity) is enforced in scoring.
    if t.isdigit():
        if len(t) < 8 or len(t) > 15:
            return True
        # allow numeric candidate to pass structural check
    else:
        # must contain at least one letter for non-pure-numeric tokens
        if not any(ch.isalpha() for ch in t):
            return True

    # reject purely alphabetic tokens (already covered but keep explicit)
    if t.isalpha():
        return True

    # reject known blacklist tokens (exact match after normalization)
    NON_BL = {'RECEIVED', 'COPY', 'DRAFT', 'ORIGINAL', 'NONNEGOTIABLE', 'BL'}
    if t in NON_BL:
        return True

    return False


def pick_best_bl_v2(text: str) -> Optional[dict]:
    """
    Robust BL extraction pipeline returning a traceable decision.

    Returns a dict with keys:
      - bl: the selected BL string or None
      - score: float in [0,1]
      - reasons: list of strings explaining the top candidate
      - candidates: list of {candidate, score, reasons} objects
    """
    try:
        if not text:
            return None
        reconstructed = _ocr_reconstruct(text)
        # candidate pool
        candidates = extract_bl_numbers(reconstructed, only_explicit=False) + extract_bl_candidates(reconstructed)
        # add permissive candidates
        for c in _generate_candidates(reconstructed):
            if c not in candidates:
                candidates.append(c)

        # include repaired tokens if helper available
        try:
            for r in repair_broken_candidates(text):
                if r and r not in candidates:
                    candidates.append(r)
        except Exception:
            pass

        scored = []
        for c in candidates:
            s, reasons = _score_candidate(c, reconstructed)
            scored.append({'candidate': c, 'score': s, 'reasons': reasons})

        scored.sort(key=lambda x: x['score'], reverse=True)
        if not scored:
            log.info('pick_best_bl_v2.no_candidates')
            return None

        top = scored[0]
        threshold = 0.35
        if top['score'] < threshold:
            log.info('pick_best_bl_v2.below_threshold', extra={'top_score': top['score']})
            return None

        result = {
            'bl': top['candidate'],
            'score': round(float(top['score']), 2),
            'reasons': top['reasons'],
            'candidates': scored
        }
        log.info('pick_best_bl_v2.selected', extra={'bl': result['bl'], 'score': result['score']})
        return result
    except Exception as e:
        log.exception('pick_best_bl_v2.error', exc_info=e)
        return None


def detect_scac(text: str) -> Optional[str]:
    """Detect a global SCAC prefix in the document, even if isolated on its own line.
    
    Checks the first ~1200 characters for common carrier SCACs and returns
    the first match found (uppercase) or None.
    """
    if not text:
        return None
    
    # Extended header zone to catch SCAC appearing early in document
    header = (text or '')[:1200].upper()
    
    # Common carrier SCACs (expand as needed)
    KNOWN_SCACS = ['MAEU', 'MEDU', 'MSCU', 'CMAU', 'COSU', 'HLCU', 'ONEY', 'SEGU']
    
    for scac in KNOWN_SCACS:
        # Match SCAC as standalone token (word boundary or on its own line)
        if re.search(rf'\b{scac}\b', header):
            log.info('detect_scac.found', extra={'scac': scac})
            return scac
    
    return None


def repair_broken_candidates(text: str) -> List[str]:
    """Reconstruct BL numbers split across lines (e.g., SCAC on one line, digits on next).

    Common OCR issue:
        MAEU
        262802788
    Should become: MAEU262802788
    """
    repaired = []
    if not text:
        return repaired
    lines = [l.strip() for l in text.split('\n') if l.strip()]
    KNOWN_SCACS = ['MAEU', 'MEDU', 'MSCU', 'CMAU', 'COSU', 'HLCU', 'ONEY', 'SEGU']
    for i in range(len(lines) - 1):
        current = lines[i].upper().strip()
        next_line = lines[i + 1].upper().strip()
        # Case 1: Current line is exactly a SCAC, next line is 6-15 digits
        if current in KNOWN_SCACS and re.match(r'^\d{6,15}$', next_line):
            reconstructed = current + next_line
            repaired.append(reconstructed)
            log.info('repair_broken_candidates.scac_digits', extra={
                'scac': current,
                'digits': next_line,
                'result': reconstructed,
            })
        
        # 🆕 Case 2: SCAC and digits on SAME line but separated by spaces/tabs
        # Example: "MAEU          262802788"
        tokens = re.split(r'\s{2,}', current)
        if len(tokens) >= 2:
            for j in range(len(tokens) - 1):
                if tokens[j] in KNOWN_SCACS and re.match(r'^\d{6,15}$', tokens[j+1]):
                    reconstructed = tokens[j] + tokens[j+1]
                    repaired.append(reconstructed)
                    log.info('repair_broken_candidates.same_line', extra={
                        'scac': tokens[j],
                        'digits': tokens[j+1],
                        'result': reconstructed,
                    })
        # Case 2: Current line ends with SCAC, next line starts with digits
        scac_match = re.search(r'([A-Z]{4})$', current)
        if scac_match:
            scac = scac_match.group(1)
            if scac in KNOWN_SCACS:
                digit_match = re.match(r'^(\d{6,15})', next_line)
                if digit_match:
                    reconstructed = scac + digit_match.group(1)
                    repaired.append(reconstructed)
                    log.info('repair_broken_candidates.trailing_scac', extra={
                        'scac': scac,
                        'digits': digit_match.group(1),
                        'result': reconstructed,
                    })
    # Deduplicate preserving order
    seen = set()
    out = []
    for r in repaired:
        if r not in seen:
            seen.add(r)
            out.append(r)
    return out


    


def pick_best_bl(text: str) -> Optional[str]:
    # Strict JSON output function: returns dict {bl_number, confidence, reason}
    if not text:
        return {'bl_number': None, 'confidence': 'low', 'reason': 'empty_text'}

    # assume caller provides normalized text; do not normalize here
    text_len = len(text)
    header_zone = text[: int(text_len * 0.25)]

    log.info('pick_best_bl.start', extra={'text_len': text_len})

    # 🆕 ÉTAPE 1 : Reconstruction SCAC + numéro
    repaired = repair_broken_candidates(text)

    # explicit: only labelled patterns (B/L, BILL OF LADING, BL NO, etc.)
    explicit = extract_bl_numbers(text, only_explicit=True)
    candidates = extract_bl_candidates(text)

    # 🆕 DEBUG : Afficher tous les candidats bruts
    log.warning('pick_best_bl.debug_candidates', extra={
        'repaired': repaired,
        'explicit': explicit[:10],
        'candidates': candidates[:10]
    })

    # 🆕 ÉTAPE 3 : Fusion avec priorité aux candidats reconstruits
    merged, seen = [], set()
    # Priorité 1 : candidats reconstruits (SCAC + digits)
    for c in repaired:
        if c and c not in seen:
            seen.add(c)
            merged.append(c)
    # Priorité 2 : candidats explicites
    for c in explicit:
        if c and c not in seen:
            seen.add(c)
            merged.append(c)
    # Priorité 3 : autres candidats
    for c in candidates:
        if c and c not in seen:
            seen.add(c)
            merged.append(c)

    if not merged:
        return {'bl_number': None, 'confidence': 'low', 'reason': 'no_candidates'}

    # ===================== STRUCTURAL FILTER (absolu, avant scoring) =====================
    filtered = []
    for t in merged:
        if is_structurally_invalid_bl(t):
            log.info('pick_best_bl.structural_reject', extra={'token': t})
            continue
        filtered.append(t)
    merged = filtered

    # do not perform absolute rejections here for seal/container proximity;
    # scoring will penalize those contexts instead so explicit labels can win

    # ===================== HELPERS =====================
    

    def is_blacklisted(token: str) -> bool:
        t = token.upper()
        return t in BLACKLIST

    def has_digits(token: str) -> bool:
        return any(ch.isdigit() for ch in token)

    def is_draft_context(token: str) -> bool:
        return any(
            candidate_near_phrase(text, token, ctx, window=50)
            for ctx in [
                'DRAFT BILL',
                'DRAFT B/L',
                'FINAL BL WILL BE READY'
            ]
        )

    def is_booking_number(token: str) -> bool:
        return any(
            candidate_near_phrase(text, token, lbl, window=100)
            for lbl in BOOKING_LABELS
        )

    def has_explicit_bl_label(token: str) -> bool:
        return any(
            candidate_near_phrase(text, token, lbl, window=120)
            for lbl in BL_LABELS
        )

    # ===================== SCORING =====================

    def score_token(token: str):
        score = 0
        reasons = []

        # BLOCK: tax/fiscal identifiers must never be accepted as BLs
        if is_tax_or_fiscal_context(text, token):
            return -999, ['tax_or_fiscal_identifier']

        # 🆕 BLOCK: port/voyage context (nouveau filtre absolu)
        if is_in_port_or_voyage_context(text, token):
            return -999, ['port_or_voyage_context']

        if not token or is_blacklisted(token):
            return -999, ['blacklisted']

        if not has_digits(token):
            return -999, ['no_digits']

        if is_iso6346(token):
            return -999, ['iso_container']

        # Numeric-only tokens are only valid when explicitly labeled or
        # strongly near BL keywords. Enforce business rule: 8-15 digits
        # AND explicit label OR proximity. Otherwise reject early.
        if token.isdigit():
            if len(token) < 8 or len(token) > 15:
                return -999, ['numeric_invalid_length']
            # 🆕 Si numérique ET pas reconstruit → pénalité forte
            if token not in repaired:
                # orphan numeric tokens (not part of a reconstructed SCAC+digits)
                score -= 50
                reasons.append('numeric_orphan_penalty')
            if not (has_explicit_bl_label(token) or candidate_near_bl_keyword(text, token, window=120)):
                return -999, ['numeric_no_bl_context']

        # NOTE: do not reject tokens solely because the document is marked DRAFT.
        # The draft context is still detectable via `is_draft_context()` but
        # we treat it as a soft signal rather than an absolute rejection.

        # 🔥 explicite
        if token in explicit:
            score += 60
            reasons.append('explicit_match')

        # 🔥 libellé BL exact
        if has_explicit_bl_label(token):
            score += 40
            reasons.append('explicit_bl_label')

        # If explicit BL label exists nearby, prefer it and avoid heavy penalties
        explicit_label_present = has_explicit_bl_label(token)

        # 🔥 Boost massif pour "B/L No." explicite
        if candidate_near_phrase(text, token, 'B/L NO', window=30):
            score += 100
            reasons.append('explicit_bl_no_label')

        # Strong boost for exact "BILL OF LADING NO" nearby (also high)
        if candidate_near_phrase(text, token, 'BILL OF LADING NO', window=30):
            score += 100
            reasons.append('bill_of_lading_no_boost')

        # 🔥 proximité BL
        if candidate_near_bl_keyword(text, token, window=150):
            score += 25
            reasons.append('near_bl_keyword')

        # 🔥 formats
        if re.match(r'^[A-Z]{2,4}\d{6,15}$', token):
            score += 35
            reasons.append('strong_format')
        elif re.match(r'^[A-Z]{2,4}[-_/]\d{6,15}$', token):
            score += 25
            reasons.append('format_with_sep')
        elif re.match(r'^[A-Z]{2,6}\d{5,15}$', token):
            score += 15
            reasons.append('fallback_alpha_digits')

        # 🔥 alpha + digits
        if any(c.isalpha() for c in token) and any(c.isdigit() for c in token):
            score += 5
            reasons.append('alpha_digits')

        # Business rule: boost common carrier prefixes (MSC-like series)
        try:
            if token.upper().startswith(('MEDU', 'MSCU')):
                score += 20
                reasons.append('msc_prefix')
        except Exception:
            pass

        # 🔥 longueur idéale
        if 8 <= len(token) <= 20:
            score += 5
            reasons.append('good_length')

        # 🔥 header
        if token in header_zone:
            score += 20
            reasons.append('header_zone')

        # 🆕 Boost massif pour candidats reconstruits SCAC + digits
        if token in repaired:
            score += 70
            reasons.append('reconstructed_scac_digits')

        # Footer label pattern: B/L: TOKEN
        try:
            if re.search(rf'B/L\s*:\s*{re.escape(token)}', text, flags=re.IGNORECASE):
                score += 60
                reasons.append('footer_bl_label')
        except re.error:
            pass

        # 🔥 fréquence
        freq = text.count(token)
        if freq > 1:
            score += min(5, freq)
            reasons.append(f'freq_{freq}')

        # ❌ penalties for risky contexts (soft signals)
        if is_booking_number(token) and not explicit_label_present:
            score -= 30
            reasons.append('booking_penalty')

        if is_seal_number_context(text, token) and not explicit_label_present:
            score -= 40
            reasons.append('seal_context_penalty')

        if is_within_container_section(text, token) and not explicit_label_present:
            score -= 40
            reasons.append('container_section_penalty')

        if is_in_forbidden_bl_context(text, token) and not explicit_label_present:
            score -= 30
            reasons.append('forbidden_context_penalty')

        return score, reasons

    # ===================== FILTRAGE FINAL =====================

    scored = []
    for t in merged:
        if is_false_positive(t):
            # still drop clear false-positives (dates, short numeric tokens)
            continue

        s, reasons = score_token(t)
        if s >= 0:
            scored.append((t, s, reasons))

    if not scored:
        return {'bl_number': None, 'confidence': 'low', 'reason': 'no_valid_candidates'}

    scored.sort(key=lambda x: (x[1], len(x[0])), reverse=True)

    best_token, best_score, best_reasons = scored[0]
    second_score = scored[1][1] if len(scored) > 1 else -999

    if best_score < MIN_SCORE or (best_score - second_score) < MIN_MARGIN:
        # Ambiguity detected: STRICT RULE -> only accept candidates with explicit BL label nearby
        log.warning(
            'pick_best_bl.ambiguous',
            extra={
                'best_token': best_token,
                'best_score': best_score,
                'second_score': second_score,
                'margin': best_score - second_score,
                'candidates': [
                    {'token': t, 'score': s, 'reasons': r}
                    for t, s, r in scored[:5]
                ]
            }
        )

        # filter to labelled candidates only
        labelled = [ (t,s,r) for (t,s,r) in scored if ('explicit_match' in r) or has_explicit_bl_label(t) ]
        if not labelled:
            return {'bl_number': None, 'confidence': 'low', 'reason': 'ambiguous_no_explicit_label'}

        # pick highest scoring labelled candidate
        labelled.sort(key=lambda x: x[1], reverse=True)
        best_token, best_score, best_reasons = labelled[0]
        best_reasons = list(best_reasons) if isinstance(best_reasons, list) else [best_reasons]
        best_reasons.append('resolved_by_label')
        log.info('pick_best_bl.resolved_by_label', extra={'token': best_token, 'score': best_score})

    # Golden rule: numeric-only BL without a detected SCAC in header -> reject
    scac = detect_scac(text)
    if best_token.isdigit():
        if scac:
            final_token = scac + best_token
            best_reasons.append(f'prepended_scac:{scac}')
            reason_text = 'reconstructed_with_scac'
        else:
            log.info('pick_best_bl.rejected_numeric_no_scac', extra={'token': best_token})
            return {'bl_number': None, 'confidence': 'low', 'reason': 'numeric_without_scac'}
    else:
        final_token = best_token
        reason_text = 'explicit_label_or_format'

    # map score to confidence levels (strict thresholds)
    if best_score >= 80:
        confidence = 'high'
    elif best_score >= 60:
        confidence = 'medium'
    elif best_score >= MIN_SCORE:
        confidence = 'low'
    else:
        confidence = 'low'

    log.info(
        'pick_best_bl.chosen',
        extra={
            'value': final_token,
            'score': best_score,
            'reasons': best_reasons,
            'candidates': [
                {'token': t, 'score': s, 'reasons': r}
                for t, s, r in scored
            ],
        }
    )

    return {'bl_number': final_token, 'confidence': confidence, 'reason': ';'.join(map(str, best_reasons or [reason_text]))}


# Lightweight wrapper that matches the requested signature in the specification:
def pick_best_bl_v2_simple(text: str) -> Optional[str]:
    """
    Deterministic wrapper around the verbose engine that returns the best BL
    as a simple string or None. It logs selection reasons for debugging and
    returns only the canonical BL value (SCAC+NUMBER when applicable).

    - Input: raw OCR text (string)
    - Output: best BL candidate string or None
    """
    try:
        verbose = pick_best_bl_v2(text) if 'pick_best_bl_v2' in globals() else None
        # If the verbose engine returns a dict with 'bl', use it
        if isinstance(verbose, dict):
            bl = verbose.get('bl') or verbose.get('bl_number')
            # If numeric-only and detect_scac finds a SCAC, reconstruct
            if bl and bl.isdigit():
                scac = detect_scac(text)
                if scac:
                    bl = scac + bl
            if bl:
                log.info('pick_best_bl_v2_simple.selected', extra={'bl': bl, 'score': verbose.get('score'), 'reasons': verbose.get('reasons')})
                return bl
        # Fallback: try existing pick_best_bl (legacy) which returns dict with bl_number
        legacy = None
        try:
            legacy = pick_best_bl(text)
        except Exception:
            legacy = None
        if isinstance(legacy, dict):
            bln = legacy.get('bl') or legacy.get('bl_number')
            if bln:
                log.info('pick_best_bl_v2_simple.fallback_legacy', extra={'bl': bln})
                return bln
        return None
    except Exception as e:
        log.exception('pick_best_bl_v2_simple.error', exc_info=e)
        return None

# Provide a convenient alias matching the requested simple name
pick_best_bl_v2_plain = pick_best_bl_v2_simple

def candidate_near_bl_keyword(text: str, token: str, window: int = 60) -> bool:
    """Return True if token occurs within `window` chars of a BL keyword."""
    T = (text or '').lower()
    tok = token.lower()
    idx = T.find(tok)
    if idx == -1:
        return False
    start = max(0, idx - window)
    end = min(len(T), idx + len(tok) + window)
    context = T[start:end]
    # BL keyword patterns
    keywords = ['bill of lading', 'billoflading', 'b/l', 'bl no', 'blno', 'b l', 'ocean bill', 'house bill', 'master bill']
    return any(k in context for k in keywords)



