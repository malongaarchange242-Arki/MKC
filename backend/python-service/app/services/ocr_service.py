import io
import ipaddress
import os
import re
import socket
import threading
import time
from typing import Optional
from urllib.parse import urlsplit

from PIL import Image, ImageOps, UnidentifiedImageError
import pytesseract
from pdf2image import convert_from_bytes
from PyPDF2 import PdfReader
import urllib3
from urllib3.util import Timeout

from core.config import Settings
from core.logging import get_logger
from services.bl_parser import pick_best_bl

_OCR_DOCUMENT_SLOTS = threading.BoundedSemaphore(Settings().OCR_MAX_CONCURRENT_DOCUMENTS)


class OCRServiceError(Exception):
    """An expected OCR/download failure safe to report to an API caller."""

    def __init__(self, code: str, message: str, status_code: int):
        super().__init__(message)
        self.code = code
        self.status_code = status_code


class OCRLimitExceeded(OCRServiceError):
    def __init__(self, code: str, message: str, status_code: int = 413):
        super().__init__(code, message, status_code)


class OCRTimeout(OCRServiceError):
    def __init__(self, code: str = "OCR_TIMEOUT", message: str = "Document processing timed out"):
        super().__init__(code, message, 504)


def _allowed_hosts(settings: Settings) -> set[str]:
    configured = {
        host.strip().lower().rstrip(".")
        for host in settings.OCR_ALLOWED_DOWNLOAD_HOSTS.split(",")
        if host.strip()
    }
    supabase_url = os.environ.get("SUPABASE_URL", "")
    if supabase_url:
        supabase_host = urlsplit(supabase_url).hostname
        if supabase_host:
            configured.add(supabase_host.lower().rstrip("."))
    return configured


def _validate_download_url(url: str, settings: Settings) -> str:
    try:
        parsed = urlsplit(str(url))
        port = parsed.port
    except ValueError as exc:
        raise OCRServiceError("INVALID_DOWNLOAD_URL", "Document URL is not allowed", 400) from exc
    if parsed.scheme.lower() != "https" or not parsed.hostname or parsed.username or parsed.password:
        raise OCRServiceError("INVALID_DOWNLOAD_URL", "Document URL is not allowed", 400)

    host = parsed.hostname.lower().rstrip(".")
    if host not in _allowed_hosts(settings):
        raise OCRServiceError("DOWNLOAD_HOST_NOT_ALLOWED", "Document host is not allowed", 400)
    if port not in (None, 443):
        raise OCRServiceError("INVALID_DOWNLOAD_URL", "Document URL is not allowed", 400)

    try:
        addresses = {
            result[4][0]
            for result in socket.getaddrinfo(host, 443, type=socket.SOCK_STREAM)
        }
    except (OSError, socket.gaierror) as exc:
        raise OCRServiceError("DOWNLOAD_DNS_FAILED", "Unable to resolve document host", 502) from exc

    if not addresses or any(not ipaddress.ip_address(address).is_global for address in addresses):
        raise OCRServiceError("DOWNLOAD_HOST_NOT_ALLOWED", "Document host is not allowed", 400)
    return host


def _download_document(url: str, settings: Settings) -> tuple[bytes, str]:
    url = str(url)
    download_deadline = time.monotonic() + settings.OCR_DOWNLOAD_TIMEOUT_SECONDS
    host = _validate_download_url(url, settings)
    parsed = urlsplit(url)
    try:
        addresses = sorted({
            result[4][0]
            for result in socket.getaddrinfo(host, 443, type=socket.SOCK_STREAM)
            if ipaddress.ip_address(result[4][0]).is_global
        })
    except (OSError, socket.gaierror, ValueError) as exc:
        raise OCRServiceError("DOWNLOAD_DNS_FAILED", "Unable to resolve document host", 502) from exc
    if not addresses:
        raise OCRServiceError("DOWNLOAD_HOST_NOT_ALLOWED", "Document host is not allowed", 400)

    pool = urllib3.HTTPSConnectionPool(
        host=addresses[0],
        port=443,
        server_hostname=host,
        assert_hostname=host,
        maxsize=1,
    )
    response = None
    try:
        request_path = parsed.path or "/"
        if parsed.query:
            request_path += f"?{parsed.query}"
        response = pool.urlopen(
            "GET",
            request_path,
            headers={"Host": host},
            redirect=False,
            retries=False,
            preload_content=False,
            timeout=Timeout(
                total=settings.OCR_DOWNLOAD_TIMEOUT_SECONDS,
                connect=min(5, settings.OCR_DOWNLOAD_TIMEOUT_SECONDS),
                read=settings.OCR_DOWNLOAD_TIMEOUT_SECONDS,
            ),
        )
        if 300 <= response.status < 400:
            raise OCRServiceError("DOWNLOAD_REDIRECT_BLOCKED", "Document redirects are not allowed", 400)
        if response.status < 200 or response.status >= 300:
            raise OCRServiceError("DOWNLOAD_FAILED", "Unable to download document", 502)

        content_length = response.headers.get("content-length")
        if content_length:
            try:
                if int(content_length) > settings.OCR_MAX_FILE_BYTES:
                    raise OCRLimitExceeded("FILE_TOO_LARGE", "Document exceeds the maximum file size")
            except ValueError:
                pass

        chunks = []
        size = 0
        for chunk in response.stream(64 * 1024, decode_content=True):
            if time.monotonic() >= download_deadline:
                raise OCRTimeout("DOWNLOAD_TIMEOUT", "Document download timed out")
            if not chunk:
                continue
            size += len(chunk)
            if size > settings.OCR_MAX_FILE_BYTES:
                raise OCRLimitExceeded("FILE_TOO_LARGE", "Document exceeds the maximum file size")
            chunks.append(chunk)
        if not size:
            raise OCRServiceError("EMPTY_DOWNLOAD", "Downloaded document is empty", 400)
        return b"".join(chunks), response.headers.get("content-type", "")
    except OCRServiceError:
        raise
    except urllib3.exceptions.TimeoutError as exc:
        raise OCRTimeout("DOWNLOAD_TIMEOUT", "Document download timed out") from exc
    except urllib3.exceptions.HTTPError as exc:
        raise OCRServiceError("DOWNLOAD_FAILED", "Unable to download document", 502) from exc
    finally:
        if response is not None:
            response.close()
        pool.close()


def _check_deadline(deadline: float) -> None:
    if time.monotonic() >= deadline:
        raise OCRTimeout()


def _has_usable_text(text: str) -> bool:
    compact = re.sub(r"\s+", "", text or "")
    alphanumeric_count = sum(char.isalnum() for char in compact)
    alphabetic_count = sum(char.isalpha() for char in compact)
    return alphanumeric_count >= 12 and alphabetic_count >= 4


def _bl_result_rank(text: str) -> tuple[int, int, int, int]:
    result = pick_best_bl(text)
    detected = int(isinstance(result, dict) and bool(result.get("bl_number")))
    confidence_rank = {"high": 3, "medium": 2, "low": 1}.get(
        str(result.get("confidence", "")).lower() if detected else "", 0
    )
    maritime_terms = ("BILL OF LADING", "VESSEL", "SHIPPER", "CONSIGNEE", "CONTAINER")
    maritime_signals = sum(term in text.upper() for term in maritime_terms)
    non_whitespace = [char for char in text if not char.isspace()]
    readable_ratio = (
        sum(char.isalnum() for char in non_whitespace) / len(non_whitespace)
        if non_whitespace
        else 0
    )
    return (detected, confidence_rank, maritime_signals, round(readable_ratio * 100))


def _ocr_image(img: Image.Image, settings: Optional[Settings] = None, deadline: Optional[float] = None) -> str:
    settings = settings or Settings()
    deadline = deadline or (time.monotonic() + settings.OCR_PROCESSING_TIMEOUT_SECONDS)
    log = get_logger()

    try:
        if img.width * img.height > settings.OCR_MAX_IMAGE_PIXELS:
            raise OCRLimitExceeded("IMAGE_TOO_LARGE", "Image dimensions exceed the processing limit")
        prepared = ImageOps.autocontrast(img.convert("L"))
    except OCRServiceError:
        raise
    except Exception as exc:
        raise OCRServiceError("INVALID_IMAGE", "Image could not be decoded", 400) from exc

    variants = [6, 4, 3][:settings.OCR_MAX_VARIANTS_PER_PAGE]
    candidates: list[tuple[tuple[int, int, int, int], str]] = []
    try:
        for psm in variants:
            _check_deadline(deadline)
            try:
                text = pytesseract.image_to_string(
                    prepared,
                    config=f"-l eng+fra --oem 3 --psm {psm} --dpi {settings.OCR_DPI} -c preserve_interword_spaces=1",
                    timeout=min(settings.OCR_TESSERACT_TIMEOUT_SECONDS, max(1, deadline - time.monotonic())),
                )
            except pytesseract.TesseractNotFoundError as exc:
                raise OCRServiceError("OCR_DEPENDENCY_UNAVAILABLE", "OCR engine is unavailable", 503) from exc
            except RuntimeError as exc:
                if "timeout" in str(exc).lower():
                    raise OCRTimeout("TESSERACT_TIMEOUT", "OCR recognition timed out") from exc
                raise OCRServiceError("OCR_ENGINE_FAILED", "OCR recognition failed", 502) from exc
            except Exception as exc:
                message = str(exc).lower()
                if any(term in message for term in ("traineddata", "failed loading language", "could not initialize tesseract")):
                    raise OCRServiceError("OCR_DEPENDENCY_UNAVAILABLE", "OCR language data is unavailable", 503) from exc
                raise OCRServiceError("OCR_ENGINE_FAILED", "OCR recognition failed", 502) from exc

            if text and text.strip():
                rank = _bl_result_rank(text)
                candidates.append((rank, text))
                if rank[0] and (rank[1] >= 3 or rank[2] >= 2):
                    break
    finally:
        prepared.close()
    log.debug("ocr_image.done", extra={"variants": len(candidates)})
    return max(candidates, key=lambda candidate: candidate[0])[1] if candidates else ""


def _extract_pdf_text(pdf_bytes: bytes, settings: Settings, deadline: float) -> tuple[str, int, int]:
    try:
        reader = PdfReader(io.BytesIO(pdf_bytes), strict=False)
        if reader.is_encrypted:
            raise OCRServiceError("INVALID_DOCUMENT", "Encrypted PDFs are not supported", 400)
        page_count = len(reader.pages)
    except OCRServiceError:
        raise
    except Exception as exc:
        raise OCRServiceError("INVALID_DOCUMENT", "PDF could not be read", 400) from exc

    if page_count == 0:
        raise OCRServiceError("INVALID_DOCUMENT", "PDF contains no pages", 400)
    if page_count > settings.OCR_MAX_PDF_PAGES:
        raise OCRLimitExceeded("TOO_MANY_PAGES", "PDF exceeds the maximum page count", 413)

    page_texts = []
    ocr_page_count = 0
    for page_index, page in enumerate(reader.pages, start=1):
        _check_deadline(deadline)
        try:
            native_text = page.extract_text() or ""
        except Exception:
            native_text = ""

        if _has_usable_text(native_text):
            page_texts.append(f"--- PAGE {page_index} ---\n{native_text.strip()}")
            continue

        try:
            page_width = float(page.mediabox.width) * settings.OCR_DPI / 72
            page_height = float(page.mediabox.height) * settings.OCR_DPI / 72
        except (AttributeError, TypeError, ValueError) as exc:
            raise OCRServiceError("INVALID_DOCUMENT", "PDF page dimensions are invalid", 400) from exc
        if page_width <= 0 or page_height <= 0:
            raise OCRServiceError("INVALID_DOCUMENT", "PDF page dimensions are invalid", 400)
        if page_width * page_height > settings.OCR_MAX_IMAGE_PIXELS:
            raise OCRLimitExceeded("PAGE_DIMENSIONS_TOO_LARGE", "PDF page dimensions exceed the processing limit")

        try:
            rendered_pages = convert_from_bytes(
                pdf_bytes,
                dpi=settings.OCR_DPI,
                fmt="png",
                thread_count=1,
                first_page=page_index,
                last_page=page_index,
                timeout=max(1, min(settings.OCR_TESSERACT_TIMEOUT_SECONDS, deadline - time.monotonic())),
            )
        except Exception as exc:
            if "timeout" in str(exc).lower():
                raise OCRTimeout("PDF_RENDER_TIMEOUT", "PDF page rendering timed out") from exc
            if "poppler" in str(exc).lower() or "pdfinfo" in str(exc).lower():
                raise OCRServiceError("OCR_DEPENDENCY_UNAVAILABLE", "PDF rendering tools are unavailable", 503) from exc
            raise OCRServiceError("PDF_RENDER_FAILED", "PDF page could not be rendered", 502) from exc

        ocr_page_count += 1
        try:
            if not rendered_pages:
                raise OCRServiceError("PDF_RENDER_FAILED", "PDF page could not be rendered", 502)
            image = rendered_pages[0]
            try:
                recognized_text = _ocr_image(image, settings, deadline)
            finally:
                image.close()
            if recognized_text.strip():
                page_texts.append(f"--- PAGE {page_index} ---\n{recognized_text.strip()}")
            else:
                page_texts.append(f"--- PAGE {page_index} ---\n")
        finally:
            for rendered_page in rendered_pages:
                rendered_page.close()

    return "\n".join(page_texts).strip(), page_count, ocr_page_count


def _normalize_text(raw_text: str) -> str:
    raw = (raw_text or "").replace("\r\n", "\n").replace("\r", "\n").upper()
    raw = re.sub(r"\b(?:[A-Z0-9]\s+){3,}[A-Z0-9]\b", lambda match: match.group(0).replace(" ", ""), raw)
    raw = re.sub(r"\bB\s*[\.\-]?\s*L\b", "B/L", raw)
    lines = [re.sub(r"[ \t]+", " ", line).strip() for line in raw.split("\n")]
    cleaned_lines = []
    blank_count = 0
    for line in lines:
        if not line:
            blank_count += 1
            if blank_count <= 1:
                cleaned_lines.append("")
        else:
            blank_count = 0
            cleaned_lines.append(line)
    return "\n".join(cleaned_lines).strip()


def ocr_from_bytes(data: bytes, content_type: Optional[str] = None) -> str:
    started_at = time.monotonic()
    settings = Settings()
    if len(data) > settings.OCR_MAX_FILE_BYTES:
        raise OCRLimitExceeded("FILE_TOO_LARGE", "Document exceeds the maximum file size")
    if not data:
        raise OCRServiceError("EMPTY_DOCUMENT", "Document is empty", 400)

    deadline = time.monotonic() + settings.OCR_PROCESSING_TIMEOUT_SECONDS
    normalized_type = (content_type or "").split(";", 1)[0].strip().lower()
    is_pdf = data[:1024].find(b"%PDF-") >= 0 or normalized_type == "application/pdf"
    if is_pdf:
        if normalized_type and normalized_type not in {"application/pdf", "application/octet-stream"}:
            raise OCRServiceError("UNSUPPORTED_FORMAT", "Document content does not match its media type", 415)
        raw_text, page_count, ocr_page_count = _extract_pdf_text(data, settings, deadline)
    else:
        if normalized_type and normalized_type not in {
            "application/octet-stream",
            "image/jpeg",
            "image/jpg",
            "image/png",
        }:
            raise OCRServiceError("UNSUPPORTED_FORMAT", "Only PDF, JPEG and PNG documents are supported", 415)
        try:
            with Image.open(io.BytesIO(data)) as image:
                image_format = (image.format or "").upper()
                if image_format not in {"JPEG", "PNG"}:
                    raise OCRServiceError("UNSUPPORTED_FORMAT", "Only PDF, JPEG and PNG documents are supported", 415)
                if image.width * image.height > settings.OCR_MAX_IMAGE_PIXELS:
                    raise OCRLimitExceeded("IMAGE_TOO_LARGE", "Image dimensions exceed the processing limit")
                image.load()
                raw_text = _ocr_image(image, settings, deadline)
            page_count, ocr_page_count = 1, 1
        except OCRServiceError:
            raise
        except (UnidentifiedImageError, OSError, Image.DecompressionBombError) as exc:
            raise OCRServiceError("INVALID_IMAGE", "Image could not be decoded", 400) from exc

    normalized = _normalize_text(raw_text)
    _check_deadline(deadline)
    get_logger().info(
        "ocr.completed",
        extra={
            "page_count": page_count,
            "ocr_page_count": ocr_page_count,
            "text_length": len(normalized),
            "text_found": bool(normalized),
            "duration_ms": round((time.monotonic() - started_at) * 1000),
        },
    )
    return normalized


def ocr_from_url(url: str) -> str:
    url = str(url)
    started_at = time.monotonic()
    settings = Settings()
    if not _OCR_DOCUMENT_SLOTS.acquire(blocking=False):
        raise OCRServiceError("OCR_BUSY", "OCR service is processing its maximum number of documents", 503)
    try:
        data, content_type = _download_document(url, settings)
        get_logger().info(
            "ocr.download.completed",
            extra={
                "file_size": len(data),
                "duration_ms": round((time.monotonic() - started_at) * 1000),
            },
        )
        return ocr_from_bytes(data, content_type)
    except OCRServiceError as exc:
        get_logger().warning(
            "ocr.processing.failed",
            extra={
                "error_code": exc.code,
                "duration_ms": round((time.monotonic() - started_at) * 1000),
            },
        )
        raise
    finally:
        _OCR_DOCUMENT_SLOTS.release()
