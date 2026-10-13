from fastapi.testclient import TestClient
import pytest
from main import app
from api.v1 import health as health_module
from services.ocr_service import OCRServiceError


client = TestClient(app)


@pytest.fixture(autouse=True)
def api_key_for_test_requests(monkeypatch):
    monkeypatch.setenv("PYTHON_SERVICE_API_KEY", "changeme")


def test_health():
    resp = client.get('/api/v1/health')
    assert resp.status_code == 200
    assert resp.json().get('status') == 'ok'


def test_ocr_health_fails_when_poppler_is_unavailable(monkeypatch):
    monkeypatch.setattr('api.v1.health.pytesseract.get_languages', lambda config: ['eng', 'fra'])
    monkeypatch.setattr('api.v1.health.pytesseract.get_tesseract_version', lambda: '5.3.0')
    monkeypatch.setattr('api.v1.health.shutil.which', lambda executable: None)

    resp = client.get('/api/v1/health/ocr')

    assert resp.status_code == 503
    assert resp.json()['detail']['service'] == 'OCR'


def test_readiness_reports_healthy_dependencies(monkeypatch):
    monkeypatch.setattr(health_module, '_ocr_status', lambda: {'status': 'ok'})
    monkeypatch.setattr(app.state, 'supabase_ready', True)

    resp = client.get('/api/v1/health/ready')

    assert resp.status_code == 200
    assert resp.json() == {
        'status': 'ok',
        'checks': {'supabase': 'ok', 'ocr': 'ok'},
    }


def test_readiness_fails_when_supabase_is_unavailable(monkeypatch):
    monkeypatch.setattr(health_module, '_ocr_status', lambda: {'status': 'ok'})
    monkeypatch.setattr(app.state, 'supabase_ready', False)

    resp = client.get('/api/v1/health/ready')

    assert resp.status_code == 503
    assert resp.json()['detail']['checks']['supabase'] == 'unavailable'


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


def test_parse_reports_ocr_errors_as_http_errors(monkeypatch):
    monkeypatch.setattr(
        'api.v1.parse.ocr_from_url',
        lambda url: (_ for _ in ()).throw(
            OCRServiceError('FILE_TOO_LARGE', 'Document exceeds the maximum file size', 413)
        ),
    )
    payload = {
        "document_id": "test-124",
        "file_url": "https://example.com/doc.pdf",
        "hint": "BL"
    }

    resp = client.post(
        '/api/v1/parse/document',
        json=payload,
        headers={"x-api-key": "changeme"},
    )

    assert resp.status_code == 413
    assert resp.json()['detail']['code'] == 'FILE_TOO_LARGE'


def test_parse_returns_success_for_readable_document_without_bl(monkeypatch):
    monkeypatch.setattr(
        'api.v1.parse.ocr_from_url',
        lambda url: 'VESSEL: NORTH STAR\nSHIPPER: TEST COMPANY',
    )
    payload = {
        "document_id": "test-125",
        "file_url": "https://example.com/doc.pdf",
        "hint": "BL"
    }

    resp = client.post(
        '/api/v1/parse/document',
        json=payload,
        headers={"x-api-key": "changeme"},
    )

    assert resp.status_code == 200
    assert resp.json()['extraction']['status'] == 'parsed'
    assert resp.json()['extraction']['bl_detected'] is False


def test_parse_marks_unreadable_document_as_unprocessable(monkeypatch):
    monkeypatch.setattr('api.v1.parse.ocr_from_url', lambda url: '')
    payload = {
        "document_id": "test-126",
        "file_url": "https://example.com/doc.pdf",
        "hint": "BL"
    }

    resp = client.post(
        '/api/v1/parse/document',
        json=payload,
        headers={"x-api-key": "changeme"},
    )

    assert resp.status_code == 422
    assert resp.json()['detail']['code'] == 'DOCUMENT_UNREADABLE'
