-- Add attachment_url column to request_messages

ALTER TABLE IF EXISTS public.request_messages
  ADD COLUMN IF NOT EXISTS attachment_url text;

-- index for faster lookups by request
CREATE INDEX IF NOT EXISTS idx_request_messages_attachment_url ON public.request_messages(attachment_url);
