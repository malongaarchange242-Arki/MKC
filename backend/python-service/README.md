# FERI/AD Python Microservice

Small FastAPI microservice responsible for OCR, classification, extraction and PDF generation.

Quick start:

1. Create a virtualenv

   python -m venv .venv
   .venv\Scripts\activate

2. Install dependencies

   pip install -r requirements.txt

3. Run the app

   uvicorn main:app --reload --port 8000

Endpoints:
- GET /api/v1/health
- GET /api/v1/health/ready (readiness: Supabase and OCR dependencies)
- GET /api/v1/health/ocr
- POST /api/v1/parse/document  (protected by API-KEY header)
- POST /api/v1/generate/feri   (protected)
- POST /api/v1/generate/ad     (protected)

Security:
- Set `PYTHON_SERVICE_API_KEY` to secure the internal API (Node -> Python).

OCR configuration:

| Variable | Default | Effect |
|---|---:|---|
| `OCR_MAX_FILE_BYTES` | `10485760` (10 MiB) | Maximum downloaded or in-memory document size |
| `OCR_MAX_PDF_PAGES` | `20` | Maximum PDF page count; documents over the limit are rejected |
| `OCR_DPI` | `200` | Resolution used to render pages that require OCR |
| `OCR_DOWNLOAD_TIMEOUT_SECONDS` | `10` | Maximum total time spent downloading a document |
| `OCR_PROCESSING_TIMEOUT_SECONDS` | `15` | Overall per-document OCR processing deadline |
| `OCR_TESSERACT_TIMEOUT_SECONDS` | `8` | Per-invocation Tesseract timeout |
| `OCR_MAX_VARIANTS_PER_PAGE` | `2` | Maximum Tesseract page-segmentation attempts per page |
| `OCR_MAX_IMAGE_PIXELS` | `40000000` | Maximum decoded image dimensions in pixels |
| `OCR_MAX_CONCURRENT_DOCUMENTS` | `2` | Maximum simultaneous document downloads/OCR jobs per service process |
| `OCR_ALLOWED_DOWNLOAD_HOSTS` | empty | Comma-separated, exact-match HTTPS host allowlist for document downloads |

The hostname from `SUPABASE_URL` is automatically trusted for signed storage URLs. Add any other storage hostname to `OCR_ALLOWED_DOWNLOAD_HOSTS`; wildcard entries are not supported. Downloads are pinned to a resolved public IP, TLS certificate validation remains bound to the configured hostname, and redirects are rejected. The service intentionally fails closed if no configured storage host matches.

PDF pages are inspected individually: pages with usable embedded text are extracted directly, while other pages are rendered and OCRed one at a time. The service supports PDF, JPEG, and PNG input; unsupported formats are rejected. OCR limit and dependency failures return a structured HTTP error rather than a successful empty extraction. `GET /api/v1/health/ocr` checks Tesseract, its English/French language data, and Poppler availability. `/api/v1/health` is a liveness check; configure the deployment readiness probe to use `/api/v1/health/ready`, which returns HTTP 503 if Supabase initialization or OCR dependencies are unavailable.

The response fields used by Node (`document_type`, `fields`, `raw_text_hash`, `raw_text_snippet`, and `extraction`) remain unchanged. If OCR fails after upload, Node keeps the uploaded document and reports per-document `ocr_status: "failed"` and an `ocr_error` containing only the HTTP status and safe error code.

The existing BL `confidence` / `bl_score` remains a deterministic parser heuristic based on structural checks, nearby BL labels, token frequency, and OCR fragmentation. It is not a calibrated statistical probability.
