FROM python:3.13-slim

# Dépendances système OCR + PDF
RUN apt-get update && apt-get install -y \
    tesseract-ocr \
    libtesseract-dev \
    poppler-utils \
    pkg-config \
    build-essential \
    libglib2.0-0 \
    libsm6 \
    libxrender1 \
    libxext6 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Python deps
COPY python-service/requirements.txt .
RUN pip install --upgrade pip && pip install -r requirements.txt

# Code
COPY python-service/ .

EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
