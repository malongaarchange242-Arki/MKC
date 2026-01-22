from app.services.bl_parser import pick_best_bl
from app.utils.text_normalizer import normalize_text
import logging
import sys

# Configure logging
logging.basicConfig(stream=sys.stderr, level=logging.INFO, format='%(message)s')

def test_case(name, text, expected_bl, should_be_none=False):
    print(f"\n--- Test Case: {name} ---")
    normalized = normalize_text(text)
    best = pick_best_bl(normalized)
    print(f"Result: {best}")
    
    if should_be_none:
        if best is None:
            print("✅ PASS (Correctly rejected)")
        else:
            print(f"❌ FAIL (Expected None, got {best})")
    else:
        if best == expected_bl:
            print(f"✅ PASS (Got {best})")
        else:
            print(f"❌ FAIL (Expected {expected_bl}, got {best})")

# 1. Maersk Numeric BL with explicit label (B/L:)
text_maersk = """
Shipper: ABC Corp
B/L: 
262802788
Consignee: XYZ Ltd
"""
test_case("Maersk Numeric BL (B/L: \\n Value)", text_maersk, "262802788")

# 2. Pure Numeric without context (False Positive)
text_random = """
Weight: 12345678 kg
Volume: 500 cbm
"""
test_case("Random Numeric (No Context)", text_random, None, should_be_none=True)

# 3. Booking No in BL context (Should be accepted)
text_booking_bl = """
Bill of Lading Number
Booking No 262802788
"""
# Here "Bill of Lading Number" provides context for the document being a BL, 
# and Booking No is the candidate. 
# Or "Booking No" labeled candidate near "Bill of Lading Number" phrase.
test_case("Booking No in BL Context", text_booking_bl, "262802788")

# 4. Booking No alone (Should be penalized/rejected if strict, user said "penalized")
# If it's the only candidate, it might still be picked if score > MIN_SCORE (45).
# If penalized (-20), it might drop below threshold.
# Let's see behavior.
text_booking_alone = """
Booking No 98765432
Date: 2023-01-01
"""
test_case("Booking No Alone (Ambiguous)", text_booking_alone, None, should_be_none=True) 
# Note: User said "penalized (not rejected brutally)". 
# If it's the ONLY candidate, does -20 drop it below 45? 
# Base score might be small. 
# We'll see. If it passes, check if score is low.

# 5. Security: VAT/Tax/Invoice
text_invoice = """
Invoice # 1234567890
Amount: 500 USD
"""
test_case("Invoice Number (Security)", text_invoice, None, should_be_none=True)

text_vat = """
VAT NO 1234567890
"""
test_case("VAT Number (Security)", text_vat, None, should_be_none=True)

# 6. User's previous case (Booking vs BL)
# Ensure we didn't break the fix for "40602918702 vs 262802788"
text_prev_issue = """
BL Number 40602918702
Booking No. 262802788
"""
# Wait, in the previous fix, 262802788 was the Booking No and it was the TRUE BL.
# So we expect 262802788.
test_case("Regression: Booking vs BL Number", text_prev_issue, "262802788")
