-- Align invoice fields with the backend's manual invoice flow.
BEGIN;

ALTER TABLE IF EXISTS invoices
  ADD COLUMN IF NOT EXISTS bill_of_lading text;

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
