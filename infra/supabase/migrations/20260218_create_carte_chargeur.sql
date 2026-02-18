-- Migration: create carte_chargeur table
-- Adds a dedicated table to store "carte chargeur" invoices

CREATE TABLE IF NOT EXISTS public.carte_chargeur (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reference text NOT NULL UNIQUE,
  client_name text,
  invoice_date date,
  objet_ref text,
  items jsonb,
  total_amount numeric,
  created_by text,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_carte_chargeur_created_at ON public.carte_chargeur (created_at);
