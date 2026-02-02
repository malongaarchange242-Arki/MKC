-- Migration: add AWAITING_PAYMENT to request_status enum
-- Date: 2026-02-02

DO $$
BEGIN
  -- If the enum type exists and the value is not present, add it.
  IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'request_status') THEN
    IF NOT EXISTS (
      SELECT 1 FROM pg_type t
      JOIN pg_enum e ON t.oid = e.enumtypid
      WHERE t.typname = 'request_status' AND e.enumlabel = 'AWAITING_PAYMENT'
    ) THEN
      ALTER TYPE request_status ADD VALUE 'AWAITING_PAYMENT';
    END IF;
  ELSE
    RAISE NOTICE 'request_status enum not found; skipping ADD VALUE';
  END IF;
EXCEPTION WHEN undefined_object THEN
  RAISE NOTICE 'request_status enum not found (exception); skipping';
END
$$;
