-- Migration: Align request_status with the backend state machine.

ALTER TYPE public.request_status ADD VALUE IF NOT EXISTS 'CREATED';
ALTER TYPE public.request_status ADD VALUE IF NOT EXISTS 'AWAITING_DOCUMENTS';
ALTER TYPE public.request_status ADD VALUE IF NOT EXISTS 'AWAITING_PAYMENT';
ALTER TYPE public.request_status ADD VALUE IF NOT EXISTS 'SUBMITTED';
ALTER TYPE public.request_status ADD VALUE IF NOT EXISTS 'UNDER_REVIEW';
ALTER TYPE public.request_status ADD VALUE IF NOT EXISTS 'DRAFT_SENT';
ALTER TYPE public.request_status ADD VALUE IF NOT EXISTS 'PROFORMAT_SENT';
ALTER TYPE public.request_status ADD VALUE IF NOT EXISTS 'PAYMENT_PROOF_UPLOADED';
ALTER TYPE public.request_status ADD VALUE IF NOT EXISTS 'PAYMENT_CONFIRMED';
ALTER TYPE public.request_status ADD VALUE IF NOT EXISTS 'VALIDATED';
ALTER TYPE public.request_status ADD VALUE IF NOT EXISTS 'ISSUED';

NOTIFY pgrst, 'reload schema';