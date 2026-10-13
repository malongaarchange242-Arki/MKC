-- Create the private Storage bucket used for final FERI and AD deliveries.
BEGIN;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'feri_documents',
  'feri_documents',
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

DROP POLICY IF EXISTS feri_documents_service_role_access ON storage.objects;

CREATE POLICY feri_documents_service_role_access
  ON storage.objects
  FOR ALL
  TO service_role
  USING (bucket_id = 'feri_documents')
  WITH CHECK (bucket_id = 'feri_documents');

ALTER TABLE public.feri_deliveries
  ADD COLUMN IF NOT EXISTS pdf_url text,
  ADD COLUMN IF NOT EXISTS file_name text,
  ADD COLUMN IF NOT EXISTS file_size bigint,
  ADD COLUMN IF NOT EXISTS mime_type text,
  ADD COLUMN IF NOT EXISTS admin_id uuid,
  ADD COLUMN IF NOT EXISTS feri_ref text,
  ADD COLUMN IF NOT EXISTS delivered_at timestamptz;

COMMIT;
