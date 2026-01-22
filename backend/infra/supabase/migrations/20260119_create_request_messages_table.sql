-- Migration: create request_messages table

CREATE TABLE IF NOT EXISTS public.request_messages (
  id uuid PRIMARY KEY,
  request_id uuid REFERENCES public.requests(id) ON DELETE CASCADE,
  sender_id uuid,
  sender_role text,
  type text,
  content text,
  document_id uuid,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_request_messages_request_id ON public.request_messages(request_id);
CREATE INDEX IF NOT EXISTS idx_request_messages_sender_id ON public.request_messages(sender_id);
