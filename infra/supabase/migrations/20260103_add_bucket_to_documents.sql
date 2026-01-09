-- Migration: Add bucket column to documents

ALTER TABLE IF EXISTS documents
ADD COLUMN IF NOT EXISTS bucket text NULL;

-- Optional: set existing rows to default bucket name 'documents'
UPDATE documents SET bucket = 'documents' WHERE bucket IS NULL;

-- Done
