-- Phase 3: commerce conversation context and customer memory.

CREATE TABLE IF NOT EXISTS public.conversation_context (
  phone_number TEXT PRIMARY KEY,
  last_product TEXT,
  last_order_id BIGINT REFERENCES public.orders(id) ON DELETE SET NULL,
  last_intent TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_conversation_context_updated_at
  ON public.conversation_context (updated_at DESC);

CREATE TABLE IF NOT EXISTS public.customer_profiles (
  phone_number TEXT PRIMARY KEY,
  total_orders INTEGER NOT NULL DEFAULT 0,
  total_spent NUMERIC(12,2) NOT NULL DEFAULT 0,
  favorite_category TEXT,
  favorite_product TEXT,
  last_order_id BIGINT REFERENCES public.orders(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_customer_profiles_last_order_id
  ON public.customer_profiles (last_order_id);

ALTER TABLE public.conversation_context ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY IF NOT EXISTS "Service role can manage conversation context"
ON public.conversation_context
FOR ALL TO service_role
USING (true)
WITH CHECK (true);

CREATE POLICY IF NOT EXISTS "Service role can manage customer profiles"
ON public.customer_profiles
FOR ALL TO service_role
USING (true)
WITH CHECK (true);