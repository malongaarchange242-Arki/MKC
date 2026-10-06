-- Migration: Add FXI number to requests

ALTER TABLE IF EXISTS public.requests
ADD COLUMN IF NOT EXISTS fxi_number text NULL;

NOTIFY pgrst, 'reload schema';