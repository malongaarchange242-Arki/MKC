from io import BytesIO
from typing import Any, Dict, Optional
from reportlab.lib.pagesizes import LETTER
from reportlab.pdfgen import canvas


def generate_pdf_from_template(
    template_name: str,
    data: Dict[str, Any],
    output_filename: Optional[str] = None,
) -> bytes:
    """Render a simple key/value PDF for the given template.

    `output_filename` is accepted for interface compatibility; the caller is
    responsible for naming the response since this function returns raw bytes.
    """
    buffer = BytesIO()
    c = canvas.Canvas(buffer, pagesize=LETTER)

    width, height = LETTER
    y = height - 50

    # Title
    c.setFont("Helvetica-Bold", 14)
    c.drawString(50, y, (template_name or "").upper())
    y -= 30

    # Content
    c.setFont("Helvetica", 10)
    for key, value in (data or {}).items():
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
