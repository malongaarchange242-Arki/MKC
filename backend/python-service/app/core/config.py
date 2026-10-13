import os
from dataclasses import dataclass, field


def _positive_int_setting(name: str, default: int, maximum: int) -> int:
    raw_value = os.environ.get(name)
    try:
        value = int(raw_value) if raw_value is not None else default
    except ValueError as exc:
        raise RuntimeError(f"{name} must be a positive integer") from exc
    if value < 1 or value > maximum:
        raise RuntimeError(f"{name} must be between 1 and {maximum}")
    return value


@dataclass
class Settings:
    APP_NAME: str = os.environ.get('APP_NAME', 'FERI-AD Document Service')
    PYTHON_SERVICE_API_KEY: str = field(default_factory=lambda: os.environ.get('PYTHON_SERVICE_API_KEY'))
    LOG_LEVEL: str = os.environ.get('LOG_LEVEL', 'INFO')
    TEMPLATE_DIR: str = os.environ.get('TEMPLATE_DIR', 'templates')
    OCR_MAX_FILE_BYTES: int = field(default_factory=lambda: _positive_int_setting('OCR_MAX_FILE_BYTES', 10 * 1024 * 1024, 100 * 1024 * 1024))
    OCR_MAX_PDF_PAGES: int = field(default_factory=lambda: _positive_int_setting('OCR_MAX_PDF_PAGES', 20, 200))
    OCR_DPI: int = field(default_factory=lambda: _positive_int_setting('OCR_DPI', 200, 400))
    OCR_DOWNLOAD_TIMEOUT_SECONDS: int = field(default_factory=lambda: _positive_int_setting('OCR_DOWNLOAD_TIMEOUT_SECONDS', 10, 120))
    OCR_PROCESSING_TIMEOUT_SECONDS: int = field(default_factory=lambda: _positive_int_setting('OCR_PROCESSING_TIMEOUT_SECONDS', 15, 300))
    OCR_TESSERACT_TIMEOUT_SECONDS: int = field(default_factory=lambda: _positive_int_setting('OCR_TESSERACT_TIMEOUT_SECONDS', 8, 120))
    OCR_MAX_VARIANTS_PER_PAGE: int = field(default_factory=lambda: _positive_int_setting('OCR_MAX_VARIANTS_PER_PAGE', 2, 3))
    OCR_MAX_IMAGE_PIXELS: int = field(default_factory=lambda: _positive_int_setting('OCR_MAX_IMAGE_PIXELS', 40_000_000, 100_000_000))
    OCR_MAX_CONCURRENT_DOCUMENTS: int = field(default_factory=lambda: _positive_int_setting('OCR_MAX_CONCURRENT_DOCUMENTS', 2, 20))
    OCR_ALLOWED_DOWNLOAD_HOSTS: str = field(default_factory=lambda: os.environ.get('OCR_ALLOWED_DOWNLOAD_HOSTS', ''))

def get_settings() -> Settings:
    if not os.environ.get('PYTHON_SERVICE_API_KEY'):
        raise RuntimeError("PYTHON_SERVICE_API_KEY is not set")
    return Settings()
