"""Regression tests for the FERI/AD PDF generation endpoints.

Covers the two integration breaks that used to make /generate/* return 500/422:
  1. pdf_service.generate_pdf_from_template() is called with template_name=...
  2. Node posts `request` + `documents`, not a flat `data` map.
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import pytest
from fastapi.testclient import TestClient


@pytest.fixture()
def client(monkeypatch):
    # Keep the app import offline and deterministic; load_dotenv() in main.py
    # never overrides variables that are already set.
    monkeypatch.setenv('PYTHON_SERVICE_API_KEY', 'unit-test-key')
    monkeypatch.setenv('SUPABASE_URL', '')
    monkeypatch.setenv('SUPABASE_SERVICE_ROLE_KEY', '')
    from main import app  # noqa: PLC0415  (import after env is configured)

    return TestClient(app)


def _node_payload():
    """The payload shape the Node backend actually sends."""
    return {
        'request_id': 'reg-001',
        'request': {
            'id': 'reg-001',
            'client': 'Test Client',
            'type': 'FERI_ONLY',
        },
        'documents': [
            {'id': 'doc-1', 'url': 'https://storage.example.com/doc1.pdf', 'mime': 'application/pdf'},
        ],
    }


def _assert_pdf(resp):
    assert resp.status_code == 200, resp.text
    assert resp.headers['content-type'] == 'application/pdf'
    assert resp.content.startswith(b'%PDF-')
    assert 'filename=' in resp.headers['content-disposition']


def test_generate_feri_returns_pdf(client):
    _assert_pdf(client.post('/api/v1/generate/feri', json=_node_payload(), headers={'x-api-key': 'unit-test-key'}))


def test_generate_ad_returns_pdf(client):
    _assert_pdf(client.post('/api/v1/generate/ad', json=_node_payload(), headers={'x-api-key': 'unit-test-key'}))


def test_generate_accepts_flat_data_map(client):
    """Backward-compatible callers may still post a flat `data` map."""
    payload = {'request_id': 'reg-002', 'data': {'reference': 'FERI-002', 'client': 'Test Client'}}
    _assert_pdf(client.post('/api/v1/generate/feri', json=payload, headers={'x-api-key': 'unit-test-key'}))


def test_generate_requires_api_key(client):
    resp = client.post('/api/v1/generate/feri', json=_node_payload())
    assert resp.status_code == 401
