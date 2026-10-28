-- Saved delivery locations are owned by a customer, while each order has one
-- independently tracked delivery record. Delivery recipient data is not copied
-- onto the customer row.

ALTER TABLE public.conversation_state
  DROP CONSTRAINT IF EXISTS conversation_state_state_check;

ALTER TABLE public.conversation_state
  ADD CONSTRAINT conversation_state_state_check
  CHECK (state IN (
    'MAIN_MENU',
    'BROWSING_PRODUCTS',
    'VIEWING_CART',
    'CHECKOUT',
    'TRACK_ORDER',
    'CUSTOMER_CARE',
    'DELIVERY_DETAILS'
  ));

CREATE TABLE IF NOT EXISTS public.delivery_addresses (
  id BIGSERIAL PRIMARY KEY,
  customer_id BIGINT NOT NULL REFERENCES public.customers(id) ON DELETE RESTRICT,
  recipient_name TEXT NOT NULL,
  recipient_phone TEXT NOT NULL,
  email TEXT,
  address_line_1 TEXT NOT NULL,
  address_line_2 TEXT,
  city TEXT NOT NULL,
  state TEXT NOT NULL,
  pincode TEXT NOT NULL CHECK (pincode ~ '^[0-9]{6}$'),
  landmark TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_delivery_addresses_customer_created_at
  ON public.delivery_addresses (customer_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.order_delivery_details (
  id BIGSERIAL PRIMARY KEY,
  order_id BIGINT NOT NULL UNIQUE REFERENCES public.orders(id) ON DELETE CASCADE,
  delivery_address_id BIGINT REFERENCES public.delivery_addresses(id) ON DELETE RESTRICT,
  customer_response TEXT NOT NULL DEFAULT 'AWAITING'
    CHECK (customer_response IN ('AWAITING', 'YES', 'NO')),
  delivery_status TEXT NOT NULL DEFAULT 'PENDING_DETAILS'
    CHECK (delivery_status IN (
      'PENDING_DETAILS',
      'DETAILS_RECEIVED',
      'READY_FOR_DELIVERY',
      'OUT_FOR_DELIVERY',
      'DELIVERED'
    )),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT order_delivery_details_address_status_check
    CHECK (
      (delivery_status = 'PENDING_DETAILS' AND delivery_address_id IS NULL)
      OR
      (delivery_status <> 'PENDING_DETAILS' AND delivery_address_id IS NOT NULL)
    )
);

CREATE INDEX IF NOT EXISTS idx_order_delivery_details_status_created_at
  ON public.order_delivery_details (delivery_status, created_at DESC);

ALTER TABLE public.delivery_addresses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_delivery_details ENABLE ROW LEVEL SECURITY;

CREATE POLICY IF NOT EXISTS "Service role can manage delivery addresses"
ON public.delivery_addresses
FOR ALL TO service_role
USING (true)
WITH CHECK (true);

CREATE POLICY IF NOT EXISTS "Service role can manage order delivery details"
ON public.order_delivery_details
FOR ALL TO service_role
USING (true)
WITH CHECK (true);

DROP TRIGGER IF EXISTS trg_delivery_addresses_updated_at ON public.delivery_addresses;
CREATE TRIGGER trg_delivery_addresses_updated_at
BEFORE UPDATE ON public.delivery_addresses
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

DROP TRIGGER IF EXISTS trg_order_delivery_details_updated_at ON public.order_delivery_details;
CREATE TRIGGER trg_order_delivery_details_updated_at
BEFORE UPDATE ON public.order_delivery_details
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
