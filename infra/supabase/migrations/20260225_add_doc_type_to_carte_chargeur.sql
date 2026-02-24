-- Migration: add doc_type to carte_chargeur
-- Adds a document type column (Facture/Proforma)

ALTER TABLE public.carte_chargeur
ADD COLUMN IF NOT EXISTS doc_type text DEFAULT 'FACTURE';

-- Optional index if queries will filter by doc_type
CREATE INDEX IF NOT EXISTS idx_carte_chargeur_doc_type ON public.carte_chargeur (doc_type);
