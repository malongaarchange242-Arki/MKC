-- Align the existing charge-card tables with POST /api/client/carte.

ALTER TABLE IF EXISTS public.carte_chargeur
  ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS reference text,
  ADD COLUMN IF NOT EXISTS client_name text,
  ADD COLUMN IF NOT EXISTS invoice_date date,
  ADD COLUMN IF NOT EXISTS objet_ref text,
  ADD COLUMN IF NOT EXISTS doc_type text DEFAULT 'FACTURE',
  ADD COLUMN IF NOT EXISTS items jsonb,
  ADD COLUMN IF NOT EXISTS total_amount numeric,
  ADD COLUMN IF NOT EXISTS created_by text,
  ADD COLUMN IF NOT EXISTS card_name text,
  ADD COLUMN IF NOT EXISTS status text DEFAULT 'ACTIVE';

CREATE TABLE IF NOT EXISTS public.carte_chargeur_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  carte_id uuid REFERENCES public.carte_chargeur(id) ON DELETE CASCADE,
  carte_chargeur_id uuid REFERENCES public.carte_chargeur(id) ON DELETE CASCADE,
  description text,
  validity_type text,
  validity_value text,
  quantity numeric,
  unit_price numeric,
  amount numeric,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE IF EXISTS public.carte_chargeur_items
  ADD COLUMN IF NOT EXISTS carte_id uuid REFERENCES public.carte_chargeur(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS carte_chargeur_id uuid REFERENCES public.carte_chargeur(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS validity_type text,
  ADD COLUMN IF NOT EXISTS validity_value text;

CREATE INDEX IF NOT EXISTS idx_carte_chargeur_items_carte_id
  ON public.carte_chargeur_items(carte_id);

NOTIFY pgrst, 'reload schema';