-- Sprint 1: audit trail for order lifecycle changes.
-- Keeps legacy order status values for backward compatibility while tracking
-- every movement through the order lifecycle.

CREATE TABLE IF NOT EXISTS public.order_status_history (
  id BIGSERIAL PRIMARY KEY,
  order_id BIGINT NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  previous_status TEXT,
  new_status TEXT NOT NULL,
  changed_by TEXT,
  changed_by_role TEXT NOT NULL DEFAULT 'admin',
  reason TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_order_status_history_order_created_at
  ON public.order_status_history (order_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_order_status_history_new_status
  ON public.order_status_history (new_status);

ALTER TABLE public.order_status_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY IF NOT EXISTS "Service role can manage order status history"
ON public.order_status_history
FOR ALL TO service_role
USING (true)
WITH CHECK (true);
