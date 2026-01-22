from app.services import bl_parser

text = '''MEDITERRANEAN SHIPPING COMPANY S.A.
BILL OF LADING No. 
DRAFT
NO.& SEQUENCE OF ORIGINAL B/L's
MEDUH9024256
...
RIDER PAGE
Page 1 of 4
MEDUH9024256
...
Seal Number:
Carrier EU26752001
...
'''

res = bl_parser.pick_best_bl(text)
print('pick_best_bl ->', res)

# Also show extracted candidates and numbers for debugging
print('extract_bl_numbers ->', bl_parser.extract_bl_numbers(text))
print('extract_bl_candidates ->', bl_parser.extract_bl_candidates(text))
