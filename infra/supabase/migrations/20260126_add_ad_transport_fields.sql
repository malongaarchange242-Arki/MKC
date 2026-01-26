-- Add AD transport metadata fields to requests table
-- Run with psql or supabase CLI: supabase db push --file 20260126_add_ad_transport_fields.sql

ALTER TABLE public.requests
  ADD COLUMN IF NOT EXISTS carrier_name text,
  ADD COLUMN IF NOT EXISTS transport_road_amount numeric,
  ADD COLUMN IF NOT EXISTS transport_river_amount numeric;

-- Optionally: add an index if you will query by carrier_name
-- CREATE INDEX IF NOT EXISTS idx_requests_carrier_name ON public.requests (carrier_name);
