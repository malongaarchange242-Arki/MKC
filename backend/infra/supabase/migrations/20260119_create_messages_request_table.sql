-- Migration: create messages_request table (canonical)

CREATE TABLE IF NOT EXISTS public.messages_request (
  id uuid PRIMARY KEY,
  request_id uuid REFERENCES public.requests(id) ON DELETE CASCADE,
  invoice_id uuid,
  sender_id uuid NOT NULL,
  sender_role text NOT NULL,
  content text NOT NULL,
  attachment_url text,
  document_id uuid,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_messages_request_request_id ON public.messages_request(request_id);
CREATE INDEX IF NOT EXISTS idx_messages_request_sender_id ON public.messages_request(sender_id);

-- Enable RLS and create minimal policies (adjust as needed when deploying)
ALTER TABLE IF EXISTS public.messages_request ENABLE ROW LEVEL SECURITY;

-- Policy: allow inserting only if auth.uid() equals sender_id
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policy WHERE polname = 'insert_own_messages' AND polrelid = 'public.messages_request'::regclass
  ) THEN
    EXECUTE $$
      CREATE POLICY "insert_own_messages"
      ON public.messages_request
      FOR INSERT
      WITH CHECK (auth.uid() = sender_id);
    $$;
  END IF;
END$$;

-- Policy: allow select for reading messages (server handles auth at API level)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policy WHERE polname = 'read_messages_by_request' AND polrelid = 'public.messages_request'::regclass
  ) THEN
    EXECUTE $$
      CREATE POLICY "read_messages_by_request"
      ON public.messages_request
      FOR SELECT
      USING (true);
    $$;
  END IF;
END$$;
