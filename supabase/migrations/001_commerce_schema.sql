CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.customers (
  id BIGSERIAL PRIMARY KEY,
  whatsapp_number TEXT NOT NULL UNIQUE,
  name TEXT,
  email TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.products (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  sku TEXT UNIQUE,
  description TEXT,
  category TEXT,
  price NUMERIC(12,2) NOT NULL CHECK (price >= 0),
  stock INTEGER NOT NULL DEFAULT 0 CHECK (stock >= 0),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  image_url TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.carts (
  id BIGSERIAL PRIMARY KEY,
  customer_id BIGINT REFERENCES public.customers(id) ON DELETE SET NULL,
  customer_phone TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'checked_out', 'abandoned', 'closed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_carts_customer_phone
  ON public.carts (customer_phone, status);

CREATE TABLE IF NOT EXISTS public.cart_items (
  id BIGSERIAL PRIMARY KEY,
  cart_id BIGINT NOT NULL REFERENCES public.carts(id) ON DELETE CASCADE,
  product_id BIGINT NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
  product_name TEXT NOT NULL,
  unit_price NUMERIC(12,2) NOT NULL CHECK (unit_price >= 0),
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (cart_id, product_id)
);

CREATE TABLE IF NOT EXISTS public.orders (
  id BIGSERIAL PRIMARY KEY,
  customer_id BIGINT REFERENCES public.customers(id) ON DELETE SET NULL,
  customer_phone TEXT NOT NULL,
  meta_message_id TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'payment_pending', 'paid', 'failed', 'cancelled', 'fulfilled')),
  subtotal NUMERIC(12,2) NOT NULL DEFAULT 0,
  tax NUMERIC(12,2) NOT NULL DEFAULT 0,
  total_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'INR',
  payment_provider TEXT NOT NULL DEFAULT 'razorpay',
  razorpay_payment_link_id TEXT,
  razorpay_payment_link_url TEXT,
  razorpay_payment_id TEXT,
  paid_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_orders_customer_phone_created_at
  ON public.orders (customer_phone, created_at DESC);

CREATE TABLE IF NOT EXISTS public.order_items (
  id BIGSERIAL PRIMARY KEY,
  order_id BIGINT NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  product_id BIGINT REFERENCES public.products(id) ON DELETE SET NULL,
  product_name TEXT NOT NULL,
  unit_price NUMERIC(12,2) NOT NULL CHECK (unit_price >= 0),
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  line_total NUMERIC(12,2) NOT NULL CHECK (line_total >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.knowledge_base (
  id BIGSERIAL PRIMARY KEY,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  source_type TEXT,
  category TEXT,
  product_id BIGINT REFERENCES public.products(id) ON DELETE SET NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_knowledge_base_search
  ON public.knowledge_base USING gin (to_tsvector('english', coalesce(title, '') || ' ' || coalesce(content, '')));

CREATE TABLE IF NOT EXISTS public.conversation_state (
  id BIGSERIAL PRIMARY KEY,
  whatsapp_number TEXT NOT NULL UNIQUE,
  state TEXT NOT NULL CHECK (state IN ('MAIN_MENU', 'BROWSING_PRODUCTS', 'VIEWING_CART', 'CHECKOUT', 'TRACK_ORDER', 'CUSTOMER_CARE')),
  context JSONB NOT NULL DEFAULT '{}'::jsonb,
  last_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.processed_webhook_events (
  id BIGSERIAL PRIMARY KEY,
  event_id TEXT NOT NULL UNIQUE,
  event_type TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.carts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cart_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.knowledge_base ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversation_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.processed_webhook_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY IF NOT EXISTS "Service role can manage customers" ON public.customers
FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY IF NOT EXISTS "Service role can manage products" ON public.products
FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY IF NOT EXISTS "Service role can manage carts" ON public.carts
FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY IF NOT EXISTS "Service role can manage cart items" ON public.cart_items
FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY IF NOT EXISTS "Service role can manage orders" ON public.orders
FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY IF NOT EXISTS "Service role can manage order items" ON public.order_items
FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY IF NOT EXISTS "Service role can manage knowledge base" ON public.knowledge_base
FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY IF NOT EXISTS "Service role can manage conversation state" ON public.conversation_state
FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY IF NOT EXISTS "Service role can manage processed webhook events" ON public.processed_webhook_events
FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_customers_updated_at ON public.customers;
CREATE TRIGGER trg_customers_updated_at
BEFORE UPDATE ON public.customers
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

DROP TRIGGER IF EXISTS trg_products_updated_at ON public.products;
CREATE TRIGGER trg_products_updated_at
BEFORE UPDATE ON public.products
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

DROP TRIGGER IF EXISTS trg_carts_updated_at ON public.carts;
CREATE TRIGGER trg_carts_updated_at
BEFORE UPDATE ON public.carts
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

DROP TRIGGER IF EXISTS trg_cart_items_updated_at ON public.cart_items;
CREATE TRIGGER trg_cart_items_updated_at
BEFORE UPDATE ON public.cart_items
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

DROP TRIGGER IF EXISTS trg_orders_updated_at ON public.orders;
CREATE TRIGGER trg_orders_updated_at
BEFORE UPDATE ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

DROP TRIGGER IF EXISTS trg_knowledge_base_updated_at ON public.knowledge_base;
CREATE TRIGGER trg_knowledge_base_updated_at
BEFORE UPDATE ON public.knowledge_base
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

DROP TRIGGER IF EXISTS trg_conversation_state_updated_at ON public.conversation_state;
CREATE TRIGGER trg_conversation_state_updated_at
BEFORE UPDATE ON public.conversation_state
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

INSERT INTO public.products (name, sku, description, category, price, stock, is_active)
VALUES
  ('Innova Smart Speaker', 'INN-001', 'Compact smart speaker with voice assistant and room-filling sound.', 'Audio', 4999.00, 25, TRUE),
  ('Innova Earbuds Pro', 'INN-002', 'Noise-cancelling wireless earbuds with fast charging case.', 'Audio', 3499.00, 40, TRUE),
  ('Innova Desk Hub', 'INN-003', 'USB-C docking station for laptops and multi-monitor work setups.', 'Accessories', 2599.00, 15, TRUE),
  ('Innova Travel Charger', 'INN-004', 'Dual-port fast charger with USB-C PD support.', 'Accessories', 1499.00, 50, TRUE)
ON CONFLICT (sku) DO NOTHING;

INSERT INTO public.knowledge_base (title, content, source_type, category)
VALUES
  ('Shipping policy', 'Orders placed before 6:00 PM are dispatched the same day in metro cities. Delivery time is typically 2 to 5 business days.', 'faq', 'shipping'),
  ('Return policy', 'Items can be returned within 7 days of delivery if they are unused and in original packaging. Refunds are processed within 5 to 7 business days after inspection.', 'faq', 'returns'),
  ('Payment support', 'Payments can be completed via Razorpay payment links shared in WhatsApp. Once payment succeeds, the order is confirmed instantly.', 'faq', 'payments'),
  ('Customer care', 'Customer care is available for order issues, product questions, and billing support. Ask a specific question and the bot will use supported knowledge articles to answer.', 'faq', 'support')
ON CONFLICT DO NOTHING;
