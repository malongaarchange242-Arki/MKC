-- schema
-- Ensure extraction fields exist on documents for extraction persistence
ALTER TABLE IF EXISTS documents
ADD COLUMN IF NOT EXISTS extraction jsonb DEFAULT '{}'::jsonb,
ADD COLUMN IF NOT EXISTS extracted_at timestamptz NULL,
ADD COLUMN IF NOT EXISTS extracted_by text NULL;

-- Ensure requests table has bl_number and bl_confidence as the canonical BL fields
ALTER TABLE IF EXISTS requests
ADD COLUMN IF NOT EXISTS bl_number text NULL,
ADD COLUMN IF NOT EXISTS bl_confidence double precision NULL;
-- Add FXI number field to requests
ALTER TABLE IF EXISTS requests
ADD COLUMN IF NOT EXISTS fxi_number text NULL;
-- Add manual BL field so client-entered BLs are persisted
ALTER TABLE IF EXISTS requests
ADD COLUMN IF NOT EXISTS manual_bl text NULL;