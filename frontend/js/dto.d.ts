// DTOs to lock the extraction/fields format for the frontend
interface FieldDTO {
  key: string;
  value: string | number | null;
  confidence?: number | null;
}

interface ExtractionDTO {
  fields?: FieldDTO[] | { [k: string]: any };
  bl_number?: string | number | null;
  bl_reference?: string | null;
  references?: { [k: string]: any } | null;
  raw_text_snippet?: string | null;
  bl_detected?: boolean;
}

interface RequestRecordDTO {
  id: string;
  reference?: string | null;
  extraction?: ExtractionDTO | null;
  bl_number?: string | number | null;
  fields?: FieldDTO[] | null;
}

// Helper return type for BL extraction
interface BlField {
  value: string;
  confidence: number | null;
}
