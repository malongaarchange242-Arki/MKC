# services/bl_parser.py
import re
from typing import List, Optional
from core.logging import get_logger
from utils.text_normalizer import normalize_text

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


def _clean(c: str) -> str:
    return re.sub(r"[^A-Z0-9]", "", c.upper())


def extract_bl_numbers(text: str) -> List[str]:
    found = []
    seen = set()
    text = normalize_text(text or '')
    log.info('extract_bl_numbers.start', extra={'text_len': len(text or '')})
    for rx in BL_REGEXES:
        for m in re.findall(rx, text or "", flags=re.IGNORECASE):
            val = m[-1] if isinstance(m, tuple) else m
            if not val:
                continue
            v = _clean(val)
            # Ignore obvious container numbers (ISO 6346) so we don't mistake
            # them for BL numbers
            if is_iso6346(v):
                log.info('extract_bl_numbers.skipping_container_like', extra={'value': v})
                continue

            # Skip if the token appears inside a container-list section
            if is_within_container_section(text, v):
                log.info('extract_bl_numbers.skipping_within_container_section', extra={'value': v})
                continue

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
    text = normalize_text(text or '')
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


def extract_seals(text: str) -> List[str]:
    """Extract seal numbers with common prefixes or adjacent to the word 'Seal'."""
    seals = []
    for m in re.finditer(r'\bSEAL\b[:#\-\s]*([A-Z0-9\-_/]{3,20})', text or '', flags=re.IGNORECASE):
        seals.append(m.group(1).upper())

    # generic tokens that may be seals
    for m in re.finditer(r'\b([A-Z]{2,4}[-_]?[A-Z0-9]{4,12})\b', text or '', flags=re.IGNORECASE):
        token = m.group(1).upper()
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
MIN_MARGIN = 10


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

    # must contain at least one letter
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


def pick_best_bl(text: str) -> Optional[str]:
    if not text:
        return None

    text = normalize_text(text)
    text_len = len(text)
    header_zone = text[: int(text_len * 0.25)]

    log.info('pick_best_bl.start', extra={'text_len': text_len})

    explicit = extract_bl_numbers(text)
    candidates = extract_bl_candidates(text)

    merged, seen = [], set()
    for c in (explicit + candidates):
        if c and c not in seen:
            seen.add(c)
            merged.append(c)

    if not merged:
        return None

    # ===================== STRUCTURAL FILTER (absolu, avant scoring) =====================
    filtered = []
    for t in merged:
        if is_structurally_invalid_bl(t):
            log.info('pick_best_bl.structural_reject', extra={'token': t})
            continue
        filtered.append(t)
    merged = filtered

    # Absolute rejection: tokens that appear inside a SEAL/CARRIER context
    filtered2 = []
    for t in merged:
        if is_seal_number_context(text, t):
            log.info('pick_best_bl.reject_seal', extra={'token': t})
            continue
        filtered2.append(t)
    merged = filtered2

    if not merged:
        return None

    # ===================== HELPERS =====================
    

    def is_blacklisted(token: str) -> bool:
        return any(b in token for b in BLACKLIST)

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

        if not token or is_blacklisted(token):
            return -999, ['blacklisted']

        if not has_digits(token):
            return -999, ['no_digits']

        if is_iso6346(token):
            return -999, ['iso_container']

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

        # Strong boost for exact "BILL OF LADING NO" nearby
        if candidate_near_phrase(text, token, 'BILL OF LADING NO', window=30):
            score += 80
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

        # 🔥 fréquence
        freq = text.count(token)
        if freq > 1:
            score += min(5, freq)
            reasons.append(f'freq_{freq}')

        # ❌ pénalité booking
        if is_booking_number(token):
            score -= 30
            reasons.append('booking_penalty')

        return score, reasons

    # ===================== FILTRAGE FINAL =====================

    scored = []
    for t in merged:
        if is_in_forbidden_bl_context(text, t):
            continue

        if is_false_positive(t):
            continue

        s, reasons = score_token(t)
        if s >= 0:
            scored.append((t, s, reasons))

    if not scored:
        return None

    scored.sort(key=lambda x: (x[1], len(x[0])), reverse=True)

    best_token, best_score, best_reasons = scored[0]
    second_score = scored[1][1] if len(scored) > 1 else -999

    if best_score < MIN_SCORE or (best_score - second_score) < MIN_MARGIN:
        log.info(
            'pick_best_bl.ambiguous',
            extra={'candidates': [
                {'token': t, 'score': s, 'reasons': r}
                for t, s, r in scored
            ]}
        )
        return None

    log.info(
        'pick_best_bl.chosen',
        extra={
            'value': best_token,
            'score': best_score,
            'reasons': best_reasons,
            'candidates': [
                {'token': t, 'score': s, 'reasons': r}
                for t, s, r in scored
            ],
        }
    )

    return best_token


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

from app.services import bl_parser
texts = [
    "Seal: EU26752001 attached",        # should be rejected
    "Bill of Lading No: MEDUH9024256",  # should be strongly selected
    "BL NO: EU26752001",                # still rejected if near SEAL context
    "MEDUH9024256 something else"       # should be selected by prefix + format
]
for t in texts:
    print(t, "->", bl_parser.pick_best_bl(t))

