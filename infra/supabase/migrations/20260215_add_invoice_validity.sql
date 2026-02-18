-- Migration: add valid_until and validity_months to invoices
-- Date: 2026-02-15

ALTER TABLE IF EXISTS invoices
  ADD COLUMN IF NOT EXISTS valid_until timestamptz NULL,
  ADD COLUMN IF NOT EXISTS validity_months integer DEFAULT 12;

-- Optional: create index on valid_until for expiry queries
CREATE INDEX IF NOT EXISTS idx_invoices_valid_until ON invoices(valid_until);
