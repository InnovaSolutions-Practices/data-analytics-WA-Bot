-- Phase 2: support ticket persistence.
-- WhatsApp intake and ticket workflow are intentionally deferred.

CREATE TABLE IF NOT EXISTS public.support_tickets (
  id BIGSERIAL PRIMARY KEY,
  ticket_number TEXT NOT NULL UNIQUE,
  customer_id BIGINT REFERENCES public.customers(id) ON DELETE SET NULL,
  customer_phone TEXT NOT NULL,
  order_id BIGINT REFERENCES public.orders(id) ON DELETE SET NULL,
  issue_type TEXT NOT NULL,
  issue_description TEXT,
  product_name TEXT,
  preferred_resolution TEXT,
  priority TEXT NOT NULL DEFAULT 'NORMAL'
    CHECK (priority IN ('LOW', 'NORMAL', 'HIGH', 'URGENT')),
  status TEXT NOT NULL DEFAULT 'OPEN'
    CHECK (status IN ('OPEN', 'IN_PROGRESS', 'WAITING_CUSTOMER', 'RESOLVED', 'CLOSED')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_support_tickets_customer_phone
  ON public.support_tickets (customer_phone, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_support_tickets_customer_id
  ON public.support_tickets (customer_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_support_tickets_order_id
  ON public.support_tickets (order_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_support_tickets_status_priority
  ON public.support_tickets (status, priority, created_at DESC);

ALTER TABLE public.support_tickets ENABLE ROW LEVEL SECURITY;

CREATE POLICY IF NOT EXISTS "Service role can manage support tickets"
ON public.support_tickets
FOR ALL TO service_role
USING (true)
WITH CHECK (true);

DROP TRIGGER IF EXISTS trg_support_tickets_updated_at ON public.support_tickets;
CREATE TRIGGER trg_support_tickets_updated_at
BEFORE UPDATE ON public.support_tickets
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
