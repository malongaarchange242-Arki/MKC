This folder contains SQL migrations for Supabase/Postgres.

Apply migrations manually using psql or your preferred migration tool (pg-migrate, supabase CLI, etc.).

Example using psql:

psql -h <host> -U <user> -d <db> -f 20251230_add_extraction_fields_and_table.sql

Or using supabase CLI:

supabase db push --file 20251230_add_extraction_fields_and_table.sql
