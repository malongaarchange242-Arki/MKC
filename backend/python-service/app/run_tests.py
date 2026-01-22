import sys
import traceback

from fastapi.testclient import TestClient

from main import app


def run():
    client = TestClient(app)

    failures = 0

    # test_health
    try:
        resp = client.get('/api/v1/health')
        assert resp.status_code == 200
        assert resp.json().get('status') == 'ok'
        print('test_health: OK')
    except Exception:
        failures += 1
        print('test_health: FAILED')
        traceback.print_exc()

    # test_parse_document_endpoint
    try:
        payload = {
            "document_id": "test-123",
            "file_url": "https://example.com/doc.pdf",
            "hint": "BL"
        }
        headers = {"x-api-key": "changeme"}
        resp = client.post('/api/v1/parse/document', json=payload, headers=headers)
        assert resp.status_code == 200
        data = resp.json()
        assert 'document_type' in data
        assert 'fields' in data
        print('test_parse_document_endpoint: OK')
    except Exception:
        failures += 1
        print('test_parse_document_endpoint: FAILED')
        traceback.print_exc()

    if failures:
        print(f"\n{failures} test(s) failed")
        sys.exit(1)
    print('\nAll tests passed')


if __name__ == '__main__':
    run()
