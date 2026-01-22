-- Migration: fix request_disputes schema
-- Make invoice_id NOT NULL, change raised_by to text with CHECK, and make reason NOT NULL

-- Ensure table exists
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='request_disputes') THEN
        -- alter invoice_id to NOT NULL
        ALTER TABLE public.request_disputes
          ALTER COLUMN invoice_id SET NOT NULL;

        -- alter raised_by type to text
        ALTER TABLE public.request_disputes
          ALTER COLUMN raised_by TYPE text USING raised_by::text;

        -- add check constraint for raised_by
        ALTER TABLE public.request_disputes
          DROP CONSTRAINT IF EXISTS chk_request_disputes_raised_by;
        ALTER TABLE public.request_disputes
          ADD CONSTRAINT chk_request_disputes_raised_by CHECK (raised_by IN ('ADMIN','CLIENT'));

        -- make reason NOT NULL
        ALTER TABLE public.request_disputes
          ALTER COLUMN reason SET NOT NULL;
    END IF;
END$$;
