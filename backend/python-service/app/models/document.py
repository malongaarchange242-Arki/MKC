# models/document.py
from pydantic import BaseModel, HttpUrl, Field, validator
from typing import Optional


class DocumentInput(BaseModel):
    document_id: str = Field(..., min_length=3)
    file_url: HttpUrl
    hint: Optional[str] = Field(None, max_length=50)

    @validator("document_id")
    def document_id_not_empty(cls, v):
        if not v.strip():
            raise ValueError("document_id must not be empty")
        return v

    @validator("hint")
    def normalize_hint(cls, v):
        if v:
            return v.strip().upper()
        return v
