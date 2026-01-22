-- Migration: Make request_drafts amount/currency/status nullable to separate business data
BEGIN;

ALTER TABLE IF EXISTS request_drafts
  ALTER COLUMN IF EXISTS amount DROP NOT NULL;

ALTER TABLE IF EXISTS request_drafts
  ALTER COLUMN IF EXISTS currency DROP NOT NULL;

ALTER TABLE IF EXISTS request_drafts
  ALTER COLUMN IF EXISTS status DROP NOT NULL;

COMMIT;
