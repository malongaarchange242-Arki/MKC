
import logging
from app.services.bl_parser import pick_best_bl, pick_best_bl_v2
from app.utils.text_normalizer import normalize_text

# Configure logging to see reasons
logging.basicConfig(level=logging.INFO)

def reproduce():
    # Simulate a Maersk Bill of Lading with broken layout
    # "262 802 788" is the BL number, but it's split across lines
    text = """
    BILL OF LADING FOR OCEAN TRANSPORT OR MULTIMODAL TRANSPORT
    SCAC: MAEU
    B/L No: 
    
    Shipper:
    MAERSK A/S
    
    Consignee:
    ORDER OF
    
    Booking No: 262
    802
    788
    
    Container No:
    MSKU1234567
    
    Seal: SEAL123456
    
    Port of Loading:
    SHANGHAI
    
    Port of Discharge:
    ROTTERDAM
    
    Description of Goods:
    262
    802
    788
    """
    
    print(f"--- Raw Text ---\n{text}\n----------------")
    
    # We pass raw text to v2 because it handles broken OCR internally
    # (Although v2 does call extract_bl_numbers which uses normalized text, 
    #  repair_broken_candidates works on the raw text pattern if we pass raw text, 
    #  but pick_best_bl_v2 expects 'text' which usually is normalized? 
    #  Wait, the prompt said "pick_best_bl_v2(text: str)". 
    #  My implementation calls `repair_broken_candidates(text)`.
    #  If I pass normalized text (where newlines are gone), repair_broken_candidates might fail 
    #  if it relies on newlines, BUT normalize_text collapses newlines to spaces.
    #  My repair regex uses `\s+` so it works on spaces too.
    #  Let's test both normalized and raw to be sure, but normally we pass normalized to pick_best_bl.)
    
    # Let's normalize first as per standard pipeline
    normalized = normalize_text(text)
    
    print(f"Normalized Text Snippet: {normalized[:100]}...")
    
    print("\n--- Running V1 (Legacy) ---")
    best_v1 = pick_best_bl(normalized)
    print(f"V1 Result: {best_v1}")

    print("\n--- Running V2 (New Engine) ---")
    # For V2, we might benefit from raw text for reconstruction if normalized text loses too much structure,
    # but normalize_text keeps sequence order. "262\n802\n788" -> "262 802 788".
    # repair_broken_candidates matches `\b(\d{3,})\s+(\d{3,})\s+(\d{3,})\b`.
    # "262 802 788" matches this.
    best_v2 = pick_best_bl_v2(normalized)
    print(f"V2 Result: {best_v2}")
    
    expected = "262802788"
    
    if best_v2 and best_v2['bl'] == expected:
        print(f"✅ PASS V2 (Got {best_v2['bl']} with score {best_v2['score']})")
        print(f"Reasons: {best_v2['reasons']}")
    else:
        print(f"❌ FAIL V2 (Expected {expected}, got {best_v2})")

if __name__ == "__main__":
    reproduce()
