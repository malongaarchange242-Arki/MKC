import io

import pytest
from PIL import Image
from reportlab.pdfgen import canvas

from services import ocr_service


def _pdf_with_pages(page_texts):
    output = io.BytesIO()
    pdf = canvas.Canvas(output)
    for text in page_texts:
        if text:
            pdf.drawString(50, 750, text)
        pdf.showPage()
    pdf.save()
    return output.getvalue()


def _large_page_pdf():
    output = io.BytesIO()
    pdf = canvas.Canvas(output, pagesize=(10000, 10000))
    pdf.showPage()
    pdf.save()
    return output.getvalue()


def _small_image():
    output = io.BytesIO()
    Image.new("RGB", (40, 30), "white").save(output, format="PNG")
    return output.getvalue()


def test_searchable_pdf_extracts_native_text_without_rendering(monkeypatch):
    monkeypatch.setattr(
        ocr_service,
        "convert_from_bytes",
        lambda *args, **kwargs: pytest.fail("text page should not be rasterized"),
    )

    result = ocr_service.ocr_from_bytes(
        _pdf_with_pages(["BILL OF LADING NO COSU123456789"]),
        "application/pdf",
    )

    assert "--- PAGE 1 ---" in result
    assert "BILL OF LADING NO COSU123456789" in result


def test_mixed_pdf_renders_only_page_without_usable_text(monkeypatch):
    rendered = Image.new("RGB", (80, 40), "white")
    calls = []

    def render_page(_data, **kwargs):
        calls.append(kwargs["first_page"])
        return [rendered.copy()]

    monkeypatch.setattr(ocr_service, "convert_from_bytes", render_page)
    monkeypatch.setattr(ocr_service, "_ocr_image", lambda image, *args: "B/L NO: MEDU1234567")

    result = ocr_service.ocr_from_bytes(
        _pdf_with_pages(["Vessel name and other useful document text", ""]),
        "application/pdf",
    )

    assert calls == [2]
    assert result.index("--- PAGE 1 ---") < result.index("--- PAGE 2 ---")
    assert "MEDU1234567" in result
    rendered.close()


def test_image_is_ocr_processed_and_normalized(monkeypatch):
    monkeypatch.setattr(ocr_service.pytesseract, "image_to_string", lambda *args, **kwargs: "Bill of Lading No: COSU123456789")

    result = ocr_service.ocr_from_bytes(_small_image(), "image/png")

    assert result == "BILL OF LADING NO: COSU123456789"


def test_ocr_variant_selection_prefers_a_plausible_bl_over_more_text(monkeypatch):
    outputs = iter([
        "A very long paragraph with no maritime details " * 8,
        "B/L NO MEDU1234567",
    ])
    monkeypatch.setattr(ocr_service.pytesseract, "image_to_string", lambda *args, **kwargs: next(outputs))
    monkeypatch.setattr(
        ocr_service,
        "pick_best_bl",
        lambda text: {"bl_number": "MEDU1234567", "confidence": "high"} if "MEDU" in text else {"bl_number": None},
    )

    result = ocr_service.ocr_from_bytes(_small_image(), "image/png")

    assert result == "B/L NO MEDU1234567"


def test_pdf_page_limit_is_an_explicit_error(monkeypatch):
    monkeypatch.setenv("OCR_MAX_PDF_PAGES", "1")
    monkeypatch.setattr(
        ocr_service,
        "convert_from_bytes",
        lambda *args, **kwargs: pytest.fail("a rejected PDF must not be rendered"),
    )

    with pytest.raises(ocr_service.OCRLimitExceeded) as error:
        ocr_service.ocr_from_bytes(_pdf_with_pages(["first page", "second page"]), "application/pdf")

    assert error.value.code == "TOO_MANY_PAGES"


def test_pdf_with_extreme_page_dimensions_is_rejected_before_rendering(monkeypatch):
    monkeypatch.setattr(
        ocr_service,
        "convert_from_bytes",
        lambda *args, **kwargs: pytest.fail("oversized PDF page must not be rendered"),
    )

    with pytest.raises(ocr_service.OCRLimitExceeded) as error:
        ocr_service.ocr_from_bytes(_large_page_pdf(), "application/pdf")

    assert error.value.code == "PAGE_DIMENSIONS_TOO_LARGE"


def test_tesseract_failure_is_not_reported_as_empty_text(monkeypatch):
    monkeypatch.setattr(
        ocr_service.pytesseract,
        "image_to_string",
        lambda *args, **kwargs: (_ for _ in ()).throw(ocr_service.pytesseract.TesseractNotFoundError()),
    )

    with pytest.raises(ocr_service.OCRServiceError) as error:
        ocr_service.ocr_from_bytes(_small_image(), "image/png")

    assert error.value.code == "OCR_DEPENDENCY_UNAVAILABLE"
    assert error.value.status_code == 503


def test_tesseract_timeout_is_reported_as_gateway_timeout(monkeypatch):
    monkeypatch.setattr(
        ocr_service.pytesseract,
        "image_to_string",
        lambda *args, **kwargs: (_ for _ in ()).throw(RuntimeError("Tesseract process timeout")),
    )

    with pytest.raises(ocr_service.OCRTimeout) as error:
        ocr_service.ocr_from_bytes(_small_image(), "image/png")

    assert error.value.code == "TESSERACT_TIMEOUT"
    assert error.value.status_code == 504


def test_unsupported_document_type_is_rejected(monkeypatch):
    with pytest.raises(ocr_service.OCRServiceError) as error:
        ocr_service.ocr_from_bytes(b"not a supported document", "application/vnd.ms-excel")

    assert error.value.code == "UNSUPPORTED_FORMAT"
    assert error.value.status_code == 415


def test_corrupt_pdf_is_rejected_as_invalid_document():
    with pytest.raises(ocr_service.OCRServiceError) as error:
        ocr_service.ocr_from_bytes(b"%PDF-not-valid", "application/pdf")

    assert error.value.code == "INVALID_DOCUMENT"
    assert error.value.status_code == 400


def test_download_rejects_untrusted_and_private_hosts_before_connecting(monkeypatch):
    monkeypatch.setenv("OCR_ALLOWED_DOWNLOAD_HOSTS", "storage.example.test")
    monkeypatch.setattr(
        ocr_service.socket,
        "getaddrinfo",
        lambda *args, **kwargs: [
            (None, None, None, None, ("127.0.0.1", 443))
        ],
    )
    monkeypatch.setattr(
        ocr_service.urllib3,
        "HTTPSConnectionPool",
        lambda *args, **kwargs: pytest.fail("unsafe destination must not be contacted"),
    )

    with pytest.raises(ocr_service.OCRServiceError) as error:
        ocr_service.ocr_from_url("https://storage.example.test/document.pdf")

    assert error.value.code == "DOWNLOAD_HOST_NOT_ALLOWED"


def test_download_rechecks_dns_before_connecting(monkeypatch):
    monkeypatch.setenv("OCR_ALLOWED_DOWNLOAD_HOSTS", "storage.example.test")
    resolutions = iter([
        [(None, None, None, None, ("8.8.8.8", 443))],
        [(None, None, None, None, ("10.0.0.7", 443))],
    ])
    monkeypatch.setattr(
        ocr_service.socket,
        "getaddrinfo",
        lambda *args, **kwargs: next(resolutions),
    )
    monkeypatch.setattr(
        ocr_service.urllib3,
        "HTTPSConnectionPool",
        lambda *args, **kwargs: pytest.fail("changed private DNS result must not be contacted"),
    )

    with pytest.raises(ocr_service.OCRServiceError) as error:
        ocr_service.ocr_from_url("https://storage.example.test/document.pdf")

    assert error.value.code == "DOWNLOAD_HOST_NOT_ALLOWED"


def test_download_rejects_unlisted_host_before_dns_lookup(monkeypatch):
    monkeypatch.setenv("OCR_ALLOWED_DOWNLOAD_HOSTS", "storage.example.test")
    monkeypatch.setattr(
        ocr_service.socket,
        "getaddrinfo",
        lambda *args, **kwargs: pytest.fail("unlisted host should not be resolved"),
    )

    with pytest.raises(ocr_service.OCRServiceError) as error:
        ocr_service.ocr_from_url("https://attacker.example/document.pdf")

    assert error.value.code == "DOWNLOAD_HOST_NOT_ALLOWED"


def test_download_pins_resolved_public_ip_and_rejects_redirects(monkeypatch):
    monkeypatch.setenv("OCR_ALLOWED_DOWNLOAD_HOSTS", "storage.example.test")
    resolutions = iter([
        [(None, None, None, None, ("8.8.8.8", 443))],
        [(None, None, None, None, ("1.1.1.1", 443))],
    ])
    monkeypatch.setattr(
        ocr_service.socket,
        "getaddrinfo",
        lambda *args, **kwargs: next(resolutions),
    )
    captured = {}

    class FakeResponse:
        status = 302
        headers = {"location": "http://127.0.0.1/private"}

        def close(self):
            self.closed = True

    response = FakeResponse()

    class FakePool:
        def __init__(self, **kwargs):
            captured.update(kwargs)

        def urlopen(self, _method, _path, **kwargs):
            captured.update(kwargs)
            return response

        def close(self):
            pass

    monkeypatch.setattr(ocr_service.urllib3, "HTTPSConnectionPool", FakePool)

    with pytest.raises(ocr_service.OCRServiceError) as error:
        ocr_service.ocr_from_url("https://storage.example.test/document.pdf")

    assert error.value.code == "DOWNLOAD_REDIRECT_BLOCKED"
    assert captured["host"] == "1.1.1.1"
    assert captured["server_hostname"] == "storage.example.test"
    assert captured["redirect"] is False
    assert response.closed


def test_download_caps_streamed_bytes_even_without_content_length(monkeypatch):
    monkeypatch.setenv("OCR_ALLOWED_DOWNLOAD_HOSTS", "storage.example.test")
    monkeypatch.setenv("OCR_MAX_FILE_BYTES", "4")
    monkeypatch.setattr(
        ocr_service.socket,
        "getaddrinfo",
        lambda *args, **kwargs: [
            (None, None, None, None, ("8.8.8.8", 443))
        ],
    )

    class FakeResponse:
        status = 200
        headers = {}

        def stream(self, *_args, **_kwargs):
            yield b"123"
            yield b"456"

        def close(self):
            self.closed = True

    response = FakeResponse()
    pool = type("FakePool", (), {"urlopen": lambda self, *args, **kwargs: response, "close": lambda self: None})()
    monkeypatch.setattr(ocr_service.urllib3, "HTTPSConnectionPool", lambda *args, **kwargs: pool)

    with pytest.raises(ocr_service.OCRLimitExceeded) as error:
        ocr_service.ocr_from_url("https://storage.example.test/document.pdf")

    assert error.value.code == "FILE_TOO_LARGE"
    assert response.closed
