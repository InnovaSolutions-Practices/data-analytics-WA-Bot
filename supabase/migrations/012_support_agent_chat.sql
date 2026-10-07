-- Phase 3.2: automatic ticket creation and customer/agent chat.

ALTER TABLE public.support_tickets
  ADD COLUMN IF NOT EXISTS image_url TEXT;

ALTER TABLE public.support_tickets
  DROP CONSTRAINT IF EXISTS support_tickets_status_check;

ALTER TABLE public.support_tickets
  ADD CONSTRAINT support_tickets_status_check
  CHECK (status IN ('OPEN', 'IN_PROGRESS', 'WAITING_CUSTOMER', 'WAITING_AGENT', 'RESOLVED', 'CLOSED'));

CREATE TABLE IF NOT EXISTS public.support_messages (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  ticket_id BIGINT NOT NULL REFERENCES public.support_tickets(id) ON DELETE CASCADE,
  sender_type TEXT NOT NULL CHECK (sender_type IN ('CUSTOMER', 'AGENT')),
  sender_id TEXT,
  message_text TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_support_messages_ticket_id
  ON public.support_messages (ticket_id);

CREATE INDEX IF NOT EXISTS idx_support_messages_created_at
  ON public.support_messages (created_at);

ALTER TABLE public.support_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY IF NOT EXISTS "Service role can manage support messages"
ON public.support_messages
FOR ALL TO service_role
USING (true)
WITH CHECK (true);