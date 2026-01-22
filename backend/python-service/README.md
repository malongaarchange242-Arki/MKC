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
- POST /api/v1/parse/document  (protected by API-KEY header)
- POST /api/v1/generate/feri   (protected)
- POST /api/v1/generate/ad     (protected)

Security:
- Use environment variable `API_KEY` to secure the internal API (Node -> Python).
