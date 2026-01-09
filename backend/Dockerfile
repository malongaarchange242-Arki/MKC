# Utiliser une image Python légère
FROM python:3.13-slim

# Installer les dépendances système pour Tesseract OCR
RUN apt-get update && apt-get install -y \
    tesseract-ocr \
    libtesseract-dev \
    pkg-config \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

# Définir le répertoire de travail
WORKDIR /app

# Copier le requirements.txt depuis python-service
COPY python-service/requirements.txt .

# Installer les dépendances Python
RUN pip install --upgrade pip
RUN pip install -r requirements.txt

# Copier tout le code depuis python-service
COPY python-service/ .

# Exposer le port utilisé par FastAPI
EXPOSE 8000

# Lancer l'application FastAPI
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
