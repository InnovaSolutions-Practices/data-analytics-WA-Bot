-- Support agent handoff sessions for post-image escalation.

CREATE TABLE IF NOT EXISTS public.support_agent_sessions (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  ticket_id BIGINT NOT NULL REFERENCES public.support_tickets(id) ON DELETE CASCADE,
  customer_phone TEXT NOT NULL,
  agent_id TEXT,
  status TEXT NOT NULL DEFAULT 'WAITING_FOR_AGENT'
    CHECK (status IN ('WAITING_FOR_AGENT', 'ACTIVE', 'CLOSED'))
);

CREATE INDEX IF NOT EXISTS idx_support_agent_sessions_ticket_id
  ON public.support_agent_sessions (ticket_id);

CREATE INDEX IF NOT EXISTS idx_support_agent_sessions_customer_phone
  ON public.support_agent_sessions (customer_phone);

CREATE INDEX IF NOT EXISTS idx_support_agent_sessions_status
  ON public.support_agent_sessions (status);

ALTER TABLE public.support_agent_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY IF NOT EXISTS "Service role can manage support agent sessions"
ON public.support_agent_sessions
FOR ALL TO service_role
USING (true)
WITH CHECK (true);