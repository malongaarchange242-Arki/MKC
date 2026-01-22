-- Migration: create invoices table
-- Date: 2026-01-17

create table if not exists invoices (
  id uuid primary key default gen_random_uuid(),
  request_id uuid,
  client_id uuid not null,
  invoice_number text unique not null,
  amount numeric not null,
  currency text default 'USD',
  bill_of_lading text,
  customer_reference text,
  status text default 'DRAFT_SENT',
  created_by uuid,
  created_at timestamptz default now()
);

-- optional index for lookups by request
create index if not exists idx_invoices_request_id on invoices(request_id);
create index if not exists idx_invoices_client_id on invoices(client_id);
