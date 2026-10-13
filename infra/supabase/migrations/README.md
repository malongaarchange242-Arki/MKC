This folder contains SQL migrations for Supabase/Postgres.

Apply migrations manually using psql or your preferred migration tool (pg-migrate, supabase CLI, etc.).

The admin "Issue Draft & Pricing" flow requires the private `request_drafts`
Storage bucket and matching metadata columns. Apply
`20261013_create_request_drafts_storage.sql` to the production Supabase project
before retrying a draft upload. The migration is idempotent and keeps the bucket
private; the backend accesses it with the service-role key and serves files
through signed URLs.

Final FERI and AD delivery uploads use the separate private `feri_documents`
Storage bucket. Apply `20261013_create_feri_documents_storage.sql` before
publishing final documents in production.

Example using psql:

psql -h <host> -U <user> -d <db> -f 20251230_add_extraction_fields_and_table.sql

Or using supabase CLI:

supabase db push --file 20251230_add_extraction_fields_and_table.sql
