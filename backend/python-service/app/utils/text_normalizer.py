import re
from typing import Match


def _compact_gapped_alphanum(match: Match) -> str:
    """Remove all whitespace and separators from a matched gapped sequence."""
    s = match.group(0)
    return re.sub(r'[\s\-\._,/\\]+', '', s)


def _compact_spaced_chars(text: str) -> str:
    """
    Compact sequences of single alphanumeric characters separated by whitespace.
    
    This is the KEY FIX for OCR-spaced-out text like:
    - "O O L U 2 1 6 4 2 1 5 8 1 0" -> "OOLU2164215810"
    - "B L   N O 2 6 0 7 9 3 8 8 5" -> "BLNO260793885" (handles multiple spaces)
    - "2 6 0 7 9 3 8 8 5" -> "260793885"
    - "B I L L   O F   L A D I N G" -> "BILLOFLADING"
    
    Strategy: Find sequences where single alphanumeric chars are separated by whitespace,
    then compact by removing all whitespace from those sequences.
    """
    def compact_sequence(m: Match) -> str:
        """Remove all whitespace from a matched spaced-out sequence."""
        sequence = m.group(0)
        return re.sub(r'\s+', '', sequence)
    
    # Pattern explanation:
    # \b - word boundary (start)
    # [A-Za-z0-9] - first alphanumeric char
    # (?: \s+ [A-Za-z0-9] ){2,} - repeat: space(s) + alphanumeric char, at least 2 times
    #   This means we need at least 3 total chars (1 + 2+ more)
    # \b - word boundary (end)
    #
    # The {2,} ensures we match sequences of 3+ spaced characters (to avoid false positives on normal words)
    pattern = r'\b(?:[A-Za-z0-9](?:\s+[A-Za-z0-9]){2,})\b'
    
    return re.sub(pattern, compact_sequence, text)


def normalize_text(text: str) -> str:
    """
    Normalize OCR text for downstream parsing.
    
    CRITICAL: Compacts spaced-out characters from OCR (the main issue causing BL detection failures).
    
    Examples handled:
    - "O O L U 2 1 6 4 2 1 5 8 1 0" -> "OOLU2164215810"
    - "B L   N O 2 6 0 7 9 3 8 8 5" -> "BLNO260793885"
    - "B I L L   O F   L A D I N G" -> "BILLOFLADING" (then normalized to "BILL OF LADING" by classifier)
    
    Steps:
    1. Compact sequences of spaced-out alphanumeric characters (CRITICAL FIX)
    2. Normalize common separators inserted by OCR
    3. Collapse remaining whitespace to single spaces
    """
    if not text:
        return ''
    
    # Work on a copy, normalize line breaks first
    t = text.replace('\r', '\n')
    
    # 🔥 STEP 1: CRITICAL - Compact spaced-out alphanumeric sequences
    # This is the main fix for OCR-blown-apart BL numbers and keywords
    # Handles cases like "O O L U 2 1 6 4" -> "OOLU2164"
    t = _compact_spaced_chars(t)
    
    # STEP 2: Normalize common separators inserted by OCR (dash/slash/underscore between words)
    # Only remove separators that are between alphanumeric chars (not at word boundaries)
    t = re.sub(r'(?<=[A-Za-z0-9])[\-_/](?=[A-Za-z0-9])', '', t)
    
    # STEP 3: Collapse all remaining whitespace (multiple spaces, tabs, newlines) to single spaces
    t = re.sub(r'\s+', ' ', t)
    
    return t.strip()
