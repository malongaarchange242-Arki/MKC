"""Scratch exploration #2 for the point-2 cleanup. Deleted after use."""
import sys

sys.path.insert(0, '.')

from services.bl_parser import pick_best_bl
from services.ocr_service import _normalize_text

# Cases transcribed from verify_bl_parser_final.py (scratch file, to be deleted).
CASES = [
    ("Maersk Numeric BL (B/L: + value on next line)",
     "\nShipper: ABC Corp\nB/L: \n262802788\nConsignee: XYZ Ltd\n", "262802788"),
    ("Random Numeric (No Context)",
     "\nWeight: 12345678 kg\nVolume: 500 cbm\n", None),
    ("Booking No in BL Context",
     "\nBill of Lading Number\nBooking No 262802788\n", "262802788"),
    ("Booking No Alone (Ambiguous)",
     "\nBooking No 98765432\nDate: 2023-01-01\n", None),
    ("Invoice Number (Security)",
     "\nInvoice # 1234567890\nAmount: 500 USD\n", None),
    ("VAT Number (Security)",
     "\nVAT NO 1234567890\n", None),
    ("Regression: Booking vs BL Number",
     "\nBL Number 40602918702\nBooking No. 262802788\n", "262802788"),
]

for name, raw, expected in CASES:
    text = _normalize_text(raw)
    res = pick_best_bl(text)
    got = res.get('bl_number') if isinstance(res, dict) else res
    conf = res.get('confidence') if isinstance(res, dict) else None
    flag = 'OK ' if got == expected else 'DIFF'
    print(f"{flag} {name!r:48} expected={expected!r:14} got={got!r} conf={conf}")

# Sanity checks for the production extraction helpers used by parse.py
from services.bl_parser import extract_containers, extract_seals, extract_weight
from api.v1.parse import _extract_after

print("\n=== extraction helpers ===")
print("containers:", extract_containers("CONTAINERS: MEDU1234567 TRLU1234567"))
print("seals:", extract_seals("SEAL: SEAL123456"))
print("weight:", extract_weight("GROSS WEIGHT 18,250.500 KGS"))
print("vessel:", _extract_after("VESSEL: MAERSK ELBA\nVOYAGE NO: 1234E", "VESSEL"))
print("voyage:", _extract_after("VESSEL: MAERSK ELBA\nVOYAGE NO: 1234E", "VOYAGE NO")
      or _extract_after("VESSEL: MAERSK ELBA\nVOYAGE NO: 1234E", "VOYAGE"))
