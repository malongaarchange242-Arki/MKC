-- Add statuses used by the backend's draft and final-delivery workflows.
-- Keep DRAFT_SENT for compatibility with requests created before SEND_DRAFT.
ALTER TYPE public.request_status ADD VALUE IF NOT EXISTS 'SEND_DRAFT';
ALTER TYPE public.request_status ADD VALUE IF NOT EXISTS 'COMPLETED';

NOTIFY pgrst, 'reload schema';
