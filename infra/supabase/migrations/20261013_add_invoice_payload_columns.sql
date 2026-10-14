-- Ensure invoices supports the complete payload written by the backend.
BEGIN;

ALTER TABLE IF EXISTS invoices
  ADD COLUMN IF NOT EXISTS request_id uuid REFERENCES requests(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS client_id uuid,
  ADD COLUMN IF NOT EXISTS source text,
  ADD COLUMN IF NOT EXISTS total_amount numeric(12, 2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS client_name text,
  ADD COLUMN IF NOT EXISTS objet text,
  ADD COLUMN IF NOT EXISTS origin text,
  ADD COLUMN IF NOT EXISTS subtotal_amount numeric(12, 2),
  ADD COLUMN IF NOT EXISTS service_fee_amount numeric(12, 2),
  ADD COLUMN IF NOT EXISTS cargo_route text,
  ADD COLUMN IF NOT EXISTS bill_of_lading text,
  ADD COLUMN IF NOT EXISTS customer_reference text,
  ADD COLUMN IF NOT EXISTS created_by uuid;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'invoices'
      AND column_name = 'request_id'
  ) THEN
    ALTER TABLE invoices
      ALTER COLUMN request_id DROP NOT NULL;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'invoices'
      AND column_name = 'client_id'
  ) THEN
    ALTER TABLE invoices
      ALTER COLUMN client_id DROP NOT NULL;
  END IF;
END;
$$;

COMMIT;
