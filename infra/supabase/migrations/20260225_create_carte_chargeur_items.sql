-- Migration: create carte_chargeur_items table
-- Stores individual line items for carte_chargeur invoices

CREATE TABLE IF NOT EXISTS public.carte_chargeur_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  carte_id uuid NOT NULL REFERENCES public.carte_chargeur(id) ON DELETE CASCADE,
  description text,
  validity_type text,
  validity_value text,
  quantity numeric,
  unit_price numeric,
  amount numeric,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_carte_chargeur_items_carte_id ON public.carte_chargeur_items (carte_id);
