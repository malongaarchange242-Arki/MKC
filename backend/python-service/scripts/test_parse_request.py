import os
import sys

import requests
import json

from core.supabase import create_signed_url

url = os.environ.get('PARSE_ENDPOINT', 'http://127.0.0.1:8000/api/v1/parse/document')

# Provide the object path inside the documents bucket (do NOT manually construct /storage/v1 URLs)
object_path = os.environ.get('TEST_OBJECT_PATH', '')
if not object_path:
    sys.exit('Set TEST_OBJECT_PATH to the object path inside the documents bucket')

# Create a signed URL via the centralized supabase client
file_url = create_signed_url(object_path, expires=60 * 60)

# Internal service key (keep secrets out of the repository; read from the environment)
api_key = os.environ.get('PYTHON_SERVICE_API_KEY', '')
if not api_key:
    sys.exit('Set PYTHON_SERVICE_API_KEY before running this script')

payload = {
    'document_id': 'test-parse-002',
    'file_url': file_url,
    'hint': 'BL'
}

headers = {
    'Content-Type': 'application/json',
    'x-api-key': api_key,
}

print('Posting to', url)
try:
    r = requests.post(url, json=payload, headers=headers, timeout=60)
    print('status', r.status_code)
    try:
        print(json.dumps(r.json(), indent=2, ensure_ascii=False))
    except Exception:
        print('response text:', r.text[:2000])
except Exception as e:
    print('error', e)
