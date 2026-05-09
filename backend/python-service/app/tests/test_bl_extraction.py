import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from services import parser_service
from utils.text_normalizer import normalize_text


def _get_bl(fields):
    for f in fields:
        if f.key == 'bl_number':
            return f.value
    return None


def test_bl_cases():
    cases = [
        ("Bill of Lading No: MEDUH9024256", "MEDUH9024256"),
        ("BL NO: EU26752001", "EU26752001"),
        ("Seal No: EU26752001 / BL No: EU26752001", "EU26752001"),
        ("SCAC MAEU\nB/L No: 262267475", "262267475"),
        ("SCAC MAEU B/L No. 262267475 Booking No. 262267475", "262267475"),
        ("SCAC MAEU\nBIL No, 262267475\nBooking No. 262267475", "262267475"),
        ("SCAC MAEU\nB|L N0. 262267475\nBooking No. 262267475", "262267475"),
        ("MEDUH9024256 something else", "MEDUH9024256"),
        ("Containers: MEDU1234567", None),
    ]

    for raw, expected in cases:
        norm = normalize_text(raw)
        fields = parser_service.parse_document_text(norm, 'BL')
        found = _get_bl(fields)
        assert found == expected
