-- Phase 2: support ticket message history.
-- Agent replies are persisted only after successful WhatsApp delivery.

CREATE TABLE IF NOT EXISTS public.ticket_messages (
  id BIGSERIAL PRIMARY KEY,
  ticket_id BIGINT NOT NULL REFERENCES public.support_tickets(id) ON DELETE CASCADE,
  sender_type TEXT NOT NULL CHECK (sender_type IN ('AGENT', 'CUSTOMER')),
  message TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ticket_messages_ticket_created_at
  ON public.ticket_messages (ticket_id, created_at ASC);

ALTER TABLE public.ticket_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY IF NOT EXISTS "Service role can manage ticket messages"
ON public.ticket_messages
FOR ALL TO service_role
USING (true)
WITH CHECK (true);
