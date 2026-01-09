from fastapi.testclient import TestClient
from main import app


client = TestClient(app)


def test_health():
    resp = client.get('/api/v1/health')
    assert resp.status_code == 200
    assert resp.json().get('status') == 'ok'


def test_parse_document_endpoint(monkeypatch):
    # Mock OCR to avoid external network call and ensure a BL token is present
    monkeypatch.setattr('services.ocr_service.ocr_from_url', lambda url: 'BILL OF LADING NO COSU123456789')
    # parse.py imports ocr_from_url directly; patch that symbol as well
    monkeypatch.setattr('api.v1.parse.ocr_from_url', lambda url: 'BILL OF LADING NO COSU123456789')

    payload = {
        "document_id": "test-123",
        "file_url": "https://example.com/doc.pdf",
        "hint": "BL"
    }
    headers = {"x-api-key": "changeme"}
    resp = client.post('/api/v1/parse/document', json=payload, headers=headers)
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert 'document_type' in data
    # Ensure BL number is present either in fields array or in extraction
    fields = data.get('fields') or []
    has_bl_field = any(f for f in fields if f.get('key') == 'bl_number')
    has_extraction_bl = bool(data.get('extraction', {}) and data['extraction'].get('bl_number'))
    assert has_bl_field or has_extraction_bl
