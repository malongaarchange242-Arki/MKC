from typing import Any, Dict, List, Optional

from pydantic import BaseModel


class GenerationRequest(BaseModel):
    """Payload for the FERI/AD PDF generation endpoints.

    The Node backend sends the full request object as `request` plus the list of
    signed document URLs as `documents`. `data` is kept for backward
    compatibility with any caller that posts a flat key/value map directly.
    """

    request_id: str
    data: Optional[Dict[str, Any]] = None
    request: Optional[Dict[str, Any]] = None
    documents: Optional[List[Dict[str, Any]]] = None
    output_filename: Optional[str] = None
