-- Migration: allow invoice_id to be nullable in request_disputes

ALTER TABLE IF EXISTS public.request_disputes
  ALTER COLUMN invoice_id DROP NOT NULL;
