ALTER TABLE public.request_disputes
  ADD COLUMN IF NOT EXISTS attachment_url text;

NOTIFY pgrst, 'reload schema';
