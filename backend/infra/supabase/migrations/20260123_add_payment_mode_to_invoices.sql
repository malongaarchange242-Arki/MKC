-- Migration: add payment_mode column to invoices
-- Adds a text column `payment_mode` to store selected payment method
BEGIN;

ALTER TABLE IF EXISTS invoices
  ADD COLUMN IF NOT EXISTS payment_mode text;

COMMIT;
