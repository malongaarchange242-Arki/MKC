-- Migration: create request_disputes table

CREATE TABLE IF NOT EXISTS public.request_disputes (
  id uuid PRIMARY KEY,
  request_id uuid REFERENCES public.requests(id) ON DELETE CASCADE,
  invoice_id uuid,
  raised_by uuid,
  reason text,
  attachment_url text,
  status text DEFAULT 'OPEN',
  created_at timestamptz DEFAULT now(),
  resolved_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_request_disputes_request_id ON public.request_disputes(request_id);
CREATE INDEX IF NOT EXISTS idx_request_disputes_raised_by ON public.request_disputes(raised_by);
