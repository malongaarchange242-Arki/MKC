-- Migration: Add extraction fields to documents and create document_extractions table

-- 1) Add extraction JSONB, extracted_at and extracted_by to documents
ALTER TABLE IF EXISTS documents
ADD COLUMN IF NOT EXISTS extraction jsonb DEFAULT '{}'::jsonb,
ADD COLUMN IF NOT EXISTS extracted_at timestamptz NULL,
ADD COLUMN IF NOT EXISTS extracted_by text NULL;

-- 2) Create document_extractions history table
CREATE TABLE IF NOT EXISTS document_extractions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  source text NOT NULL,
  extraction jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 3) Optional index for faster lookups on document_extractions
CREATE INDEX IF NOT EXISTS idx_document_extractions_document_id ON document_extractions(document_id);

-- 4) Grant minimal privileges (adjust role names as needed)
-- GRANT SELECT, INSERT ON document_extractions TO authenticated;

-- 5) Ensure gen_random_uuid() is available (pgcrypto extension)
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Done
