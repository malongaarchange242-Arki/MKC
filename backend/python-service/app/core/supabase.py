import os
import logging
from typing import Optional

try:
    from supabase import create_client
except Exception:
    create_client = None

from core.logging import get_logger

log = get_logger('core.supabase')

SUPABASE_URL = os.environ.get('SUPABASE_URL')
SUPABASE_SERVICE_ROLE_KEY = os.environ.get('SUPABASE_SERVICE_ROLE_KEY')
BUCKET = os.environ.get('SUPABASE_DOCUMENTS_BUCKET', 'documents')

if not SUPABASE_URL or not SUPABASE_SERVICE_ROLE_KEY:
    log.error('Supabase configuration missing: ensure SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are set')
    raise RuntimeError('Missing Supabase configuration (SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY)')

if create_client is None:
    log.error('supabase package not installed. Please add "supabase" to requirements.txt')
    raise RuntimeError('supabase SDK not available')

# -------------------------------------------------
# Initialize client (service-role)
# -------------------------------------------------
supabase = create_client(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)


def _check_bucket_access() -> None:
    """
    Verify that the storage bucket exists and is accessible.
    Do NOT use unsupported args (e.g. limit) — supabase-py doesn't support them.
    """
    try:
        res = supabase.storage.from_(BUCKET).list()
        log.info(
            'Supabase client initialized',
            extra={
                'url': SUPABASE_URL,
                'bucket': BUCKET,
                'files_count': len(res) if isinstance(res, list) else 'unknown'
            }
        )
    except Exception as e:
        log.error('Failed to access Supabase storage bucket', exc_info=e)
        raise


def create_signed_url(file_path: str, expires: int = 3600) -> str:
    """Create a signed URL for an object in the configured documents bucket."""
    try:
        result = supabase.storage.from_(BUCKET).create_signed_url(file_path, expires)

        if isinstance(result, dict):
            data = result.get('data') or result
            if isinstance(data, dict):
                for k in ('signed_url', 'signedURL', 'signedUrl'):
                    if data.get(k):
                        return data[k]

        raise RuntimeError(f'Unexpected signed URL response: {result}')
    except Exception as e:
        log.exception('create_signed_url failed', exc_info=e)
        raise


def list_files(path: str = ''):
    return supabase.storage.from_(BUCKET).list(path)


# -------------------------------------------------
# Run quick check on import
# -------------------------------------------------
_check_bucket_access()
