# extraction.py
from pydantic import BaseModel, Field as PydanticField, validator
import logging

_log = logging.getLogger('parser.models.extraction')
from typing import List, Any, Optional, Dict


class ExtractedField(BaseModel):
    key: str
    value: Any
    confidence: Optional[float] = PydanticField(
        None, ge=0.0, le=1.0, description="Confidence score between 0 and 1"
    )

    @validator("key")
    def key_must_not_be_empty(cls, v: str):
        if not v or not v.strip():
            raise ValueError("Field key must not be empty")
        return v.strip()


class ExtractionResponse(BaseModel):
    document_type: str
    fields: List[ExtractedField]
    raw_text_hash: str
    raw_text_snippet: Optional[str] = None

    # Optional structured extraction (debug / advanced use)
    extraction: Optional[Dict[str, Any]] = None

    @validator("document_type")
    def document_type_upper(cls, v: str):
        return v.upper()

    @validator("fields")
    def validate_required_fields(cls, fields, values):
        doc_type = values.get("document_type")

        if doc_type == "BL":
            # Accept missing `bl_number` to be more tolerant: log a warning
            # but do not raise an exception so downstream callers can persist
            # the full extraction JSON and decide later.
            try:
                keys = {f.key for f in fields}
            except Exception:
                keys = set()

            if "bl_number" not in keys:
                _log.warning("BL document missing 'bl_number' in fields; continuing without strict validation")
        return fields

# Backwards-compatibility alias used by other modules
Field = ExtractedField
