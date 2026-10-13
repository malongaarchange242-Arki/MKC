-- Create the private storage bucket and metadata columns required by DraftsService.
BEGIN;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'request_drafts',
  'request_drafts',
  false,
  10485760,
  ARRAY['application/pdf']::text[]
)
ON CONFLICT (id) DO UPDATE
SET
  name = EXCLUDED.name,
  public = false,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

CREATE TABLE IF NOT EXISTS public.request_drafts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL REFERENCES public.requests(id) ON DELETE CASCADE,
  uploaded_by uuid,
  issued_by uuid,
  file_name text,
  file_path text,
  type text,
  visibility text,
  invoice_id uuid REFERENCES public.invoices(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.request_drafts
  ADD COLUMN IF NOT EXISTS uploaded_by uuid,
  ADD COLUMN IF NOT EXISTS issued_by uuid,
  ADD COLUMN IF NOT EXISTS file_name text,
  ADD COLUMN IF NOT EXISTS file_path text,
  ADD COLUMN IF NOT EXISTS type text,
  ADD COLUMN IF NOT EXISTS visibility text,
  ADD COLUMN IF NOT EXISTS invoice_id uuid REFERENCES public.invoices(id) ON DELETE SET NULL;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'request_drafts'
      AND column_name = 'payload'
      AND is_nullable = 'NO'
  ) THEN
    ALTER TABLE public.request_drafts
      ALTER COLUMN payload DROP NOT NULL;
  END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS idx_request_drafts_request_id
  ON public.request_drafts(request_id);

CREATE INDEX IF NOT EXISTS idx_request_drafts_invoice_id
  ON public.request_drafts(invoice_id);

COMMIT;
