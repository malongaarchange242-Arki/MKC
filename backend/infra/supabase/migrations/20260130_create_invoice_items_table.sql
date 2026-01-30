-- Migration: create invoice_items table
-- Creates a table to store per-invoice line items with quantities and pricing
BEGIN;

CREATE TABLE IF NOT EXISTS invoice_items (
  id uuid NOT NULL,
  invoice_id uuid NOT NULL,
  description text,
  bl_number text,
  packaging text,
  unit_price numeric,
  quantity numeric,
  line_total numeric,
  position int4,
  created_at timestamptz DEFAULT now(),
  CONSTRAINT invoice_items_pkey PRIMARY KEY (id),
  CONSTRAINT invoice_items_invoice_fk FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE CASCADE
);

COMMIT;
