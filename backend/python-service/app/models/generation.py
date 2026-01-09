from pydantic import BaseModel
from typing import Any, Dict, Optional

class GenerationRequest(BaseModel):
    request_id: str
    data: Dict[str, Any]
    output_filename: Optional[str] = None
