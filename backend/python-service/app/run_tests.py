import os
import sys
import traceback

from fastapi.testclient import TestClient

from main import app


def run():
    api_key = os.environ.get('PYTHON_SERVICE_API_KEY')
    if not api_key:
        sys.exit('PYTHON_SERVICE_API_KEY must be set in the environment to run the endpoint tests')

    client = TestClient(app)
    failures = 0

    def check(name, condition, detail=''):
        nonlocal failures
        if condition:
            print(f'{name}: OK')
        else:
            failures += 1
            print(f'{name}: FAILED {detail}')

    # ---------------------------------------------------------
    # Health (public)
    # ---------------------------------------------------------
    try:
        resp = client.get('/api/v1/health')
        check('test_health', resp.status_code == 200 and resp.json().get('status') == 'ok', resp.text)
    except Exception:
        failures += 1
        print('test_health: FAILED')
        traceback.print_exc()

    # ---------------------------------------------------------
    # Parse endpoint: rejected without an API key (401)
    # ---------------------------------------------------------
    try:
        payload = {
            'document_id': 'test-123',
            'file_url': 'https://example.com/doc.pdf',
            'hint': 'BL',
        }
        resp = client.post('/api/v1/parse/document', json=payload)
        check('test_parse_requires_api_key', resp.status_code == 401, resp.text)
    except Exception:
        failures += 1
        print('test_parse_requires_api_key: FAILED')
        traceback.print_exc()

    # ---------------------------------------------------------
    # Parse endpoint: non-allowlisted download host is refused
    # (deterministic: no network call is attempted)
    # ---------------------------------------------------------
    try:
        payload = {
            'document_id': 'test-123',
            'file_url': 'https://example.com/doc.pdf',
            'hint': 'BL',
        }
        headers = {'x-api-key': api_key}
        resp = client.post('/api/v1/parse/document', json=payload, headers=headers)
        detail = resp.json().get('detail') or {}
        check(
            'test_parse_rejects_unknown_host',
            resp.status_code == 400 and detail.get('code') == 'DOWNLOAD_HOST_NOT_ALLOWED',
            resp.text,
        )
    except Exception:
        failures += 1
        print('test_parse_rejects_unknown_host: FAILED')
        traceback.print_exc()

    # ---------------------------------------------------------
    # Generate endpoints: FERI / AD PDFs are produced
    # (Node posts `request` + `documents`, not a flat `data` map)
    # ---------------------------------------------------------
    for kind in ('feri', 'ad'):
        try:
            payload = {
                'request_id': 'test-001',
                'request': {
                    'id': 'test-001',
                    'client': 'Test Client',
                    'type': 'FERI_ONLY',
                },
                'documents': [],
            }
            headers = {'x-api-key': api_key}
            resp = client.post(f'/api/v1/generate/{kind}', json=payload, headers=headers)
            is_pdf = resp.headers.get('content-type') == 'application/pdf' and resp.content.startswith(b'%PDF')
            check(f'test_generate_{kind}', resp.status_code == 200 and is_pdf, resp.text[:200])
        except Exception:
            failures += 1
            print(f'test_generate_{kind}: FAILED')
            traceback.print_exc()

    if failures:
        print(f'\n{failures} test(s) failed')
        sys.exit(1)
    print('\nAll tests passed')


if __name__ == '__main__':
    run()
