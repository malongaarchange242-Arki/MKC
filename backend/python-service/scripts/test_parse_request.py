import requests
import json
from core.supabase import create_signed_url

url = 'http://127.0.0.1:8000/api/v1/parse/document'

# Provide the object path inside the documents bucket (do NOT manually construct /storage/v1 URLs)
object_path = '0199fb7e-d3f6-42a9-a3fb-f80279cebed3/0ba9f6ae-ad18-4a24-8516-77cf197b0dad.pdf'

# Create a signed URL via the centralized supabase client
file_url = create_signed_url(object_path, expires=60*60)

# Token provided by user (will be sent as Bearer in Authorization header)
user_token = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJjMWQ5OTQ1NS1jOGJjLTRlNjktYjM4My1iY2IyYmU5ZjE0OTciLCJlbWFpbCI6ImNsaWVudEBleGFtcGxlLmNvbSIsInJvbGUiOiJDTElFTlQiLCJpYXQiOjE3NjcyNTgzMzMsImV4cCI6MTc2NzM0NDczMywiYXVkIjoiZmVyaS1hZC1jbGllbnQiLCJpc3MiOiJmZXJpLWFkLWJhY2tlbmQifQ.c8n2ql8pRsAfZtIO6IS6fJqqi-2KrbbVh6z0rHSjZUM'

payload = {
    'document_id': 'test-parse-002',
    'file_url': file_url,
    'hint': 'BL'
}

headers = {
    'Content-Type': 'application/json',
    'x-api-key': 'changeme',
    'Authorization': f'Bearer {user_token}'
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
