-- Align both message tables with the API payload and message history UI.
BEGIN;

ALTER TABLE IF EXISTS public.messages_request
  ADD COLUMN IF NOT EXISTS sender_role text,
  ADD COLUMN IF NOT EXISTS attachment_url text;

ALTER TABLE IF EXISTS public.request_messages
  ADD COLUMN IF NOT EXISTS sender_role text,
  ADD COLUMN IF NOT EXISTS attachment_url text;

NOTIFY pgrst, 'reload schema';
COMMIT;
