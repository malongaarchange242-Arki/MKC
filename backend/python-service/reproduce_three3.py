from app.services.bl_parser import pick_best_bl
from app.utils.text_normalizer import normalize_text
import logging
import sys

# Configure logging
logging.basicConfig(stream=sys.stderr, level=logging.INFO, format='%(message)s')

# Text simulating the scenario where THREE3 appears near BL Number header
text = """
BL Number 	 Ref # 	 Last Updated 	 Status 	 Country 	 Invoice # 	 Actions 
 THREE3 	 --- 	 22/01/2026 08:36:24 	 Processing 	 
 flag 
 ---
"""

print("--- Original Text ---")
print(text)

normalized = normalize_text(text)
print(f"\n--- Normalized ---\n{normalized}")

best = pick_best_bl(normalized)
print(f"\n--- Result ---\nBest BL: {best}")
