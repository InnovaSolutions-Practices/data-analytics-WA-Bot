-- Phase 3.1: support session draft layer before ticket creation.
-- Keeps the formal support_tickets table intact while collecting issue details
-- in a lightweight session that can later convert into a ticket.

CREATE TABLE IF NOT EXISTS public.support_sessions (
  id BIGSERIAL PRIMARY KEY,
  customer_id BIGINT REFERENCES public.customers(id) ON DELETE SET NULL,
  customer_phone TEXT NOT NULL,
  order_id BIGINT REFERENCES public.orders(id) ON DELETE SET NULL,
  issue_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'IN_PROGRESS'
    CHECK (status IN ('IN_PROGRESS', 'WAITING_USER', 'READY', 'CLOSED')),
  current_step TEXT NOT NULL DEFAULT 'ASK_PRODUCT'
    CHECK (current_step IN (
      'ASK_PRODUCT',
      'ASK_ISSUE',
      'ASK_RESOLUTION',
      'ASK_IMAGE',
      'WAITING_USER_DECISION'
    )),
  product_name TEXT,
  issue_description TEXT,
  preferred_resolution TEXT,
  summary_text TEXT,
  collected_data JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  closed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_support_sessions_customer_phone
  ON public.support_sessions (customer_phone, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_support_sessions_order_id
  ON public.support_sessions (order_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_support_sessions_status
  ON public.support_sessions (status, created_at DESC);

ALTER TABLE public.support_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY IF NOT EXISTS "Service role can manage support sessions"
ON public.support_sessions
FOR ALL TO service_role
USING (true)
WITH CHECK (true);

DROP TRIGGER IF EXISTS trg_support_sessions_updated_at ON public.support_sessions;
CREATE TRIGGER trg_support_sessions_updated_at
BEFORE UPDATE ON public.support_sessions
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();