from io import BytesIO
from typing import Dict, Any
from reportlab.lib.pagesizes import LETTER
from reportlab.pdfgen import canvas


def generate_pdf_from_template(
    kind: str,
    data: Dict[str, Any],
    output_filename: str = None
) -> bytes:
    buffer = BytesIO()
    c = canvas.Canvas(buffer, pagesize=LETTER)

    width, height = LETTER
    y = height - 50

    # Title
    c.setFont("Helvetica-Bold", 14)
    c.drawString(50, y, kind)
    y -= 30

    # Content
    c.setFont("Helvetica", 10)
    for key, value in data.items():
        c.drawString(50, y, f"{key}: {value}")
        y -= 18
        if y < 50:
            c.showPage()
            y = height - 50
            c.setFont("Helvetica", 10)

    c.showPage()
    c.save()

    buffer.seek(0)
    return buffer.read()
