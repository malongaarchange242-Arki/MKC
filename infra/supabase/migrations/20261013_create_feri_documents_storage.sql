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

COMMIT;
