-- Migration: add cargo_route column to invoices
-- Adds a text column `cargo_route` to store origin → destination information
BEGIN;

ALTER TABLE IF EXISTS invoices
  ADD COLUMN IF NOT EXISTS cargo_route text;

COMMIT;
