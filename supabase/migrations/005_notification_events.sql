-- Sprint 1: customer and admin notification event tracking.
-- Notification delivery is intentionally separated from the status transition logic.
-- This table stores the event payload and its lifecycle without sending WhatsApp yet.

CREATE TABLE IF NOT EXISTS public.notification_events (
  id BIGSERIAL PRIMARY KEY,
  order_id BIGINT REFERENCES public.orders(id) ON DELETE SET NULL,
  customer_phone TEXT NOT NULL,
  event_type TEXT NOT NULL,
  channel TEXT NOT NULL DEFAULT 'whatsapp',
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'sent', 'failed', 'delivered', 'skipped')),
  related_status TEXT,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sent_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notification_events_order_id
  ON public.notification_events (order_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_notification_events_customer_phone
  ON public.notification_events (customer_phone, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_notification_events_status
  ON public.notification_events (status, created_at DESC);

ALTER TABLE public.notification_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY IF NOT EXISTS "Service role can manage notification events"
ON public.notification_events
FOR ALL TO service_role
USING (true)
WITH CHECK (true);

CREATE OR REPLACE FUNCTION public.touch_notification_event_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_notification_events_updated_at ON public.notification_events;
CREATE TRIGGER trg_notification_events_updated_at
BEFORE UPDATE ON public.notification_events
FOR EACH ROW EXECUTE FUNCTION public.touch_notification_event_updated_at();
