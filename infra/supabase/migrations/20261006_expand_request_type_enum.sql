-- Migration: Align request_type with the backend request model.

ALTER TYPE public.request_type ADD VALUE IF NOT EXISTS 'FERI_ONLY';
ALTER TYPE public.request_type ADD VALUE IF NOT EXISTS 'FERI_AND_AD';

NOTIFY pgrst, 'reload schema';