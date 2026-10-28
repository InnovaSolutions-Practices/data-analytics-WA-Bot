-- Brings the live public.orders table in line with what commerce.ts / 001_commerce_schema.sql
-- expect. 001 used CREATE TABLE IF NOT EXISTS, so it silently no-op'd on orders since the
-- table already existed in its old single-item shape (product_id/amount NOT NULL, no
-- subtotal/tax/currency/payment_provider). This migration adds what's missing and relaxes
-- the legacy single-item columns that the new cart/order_items-based flow does not populate.

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS customer_id BIGINT REFERENCES public.customers(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS subtotal NUMERIC(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS tax NUMERIC(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS currency TEXT NOT NULL DEFAULT 'INR',
  ADD COLUMN IF NOT EXISTS payment_provider TEXT NOT NULL DEFAULT 'razorpay';

-- Legacy single-item columns: still populated by the old processBuyCommand()/checkoutCart()
-- path in index.ts, but the multi-item createOrderFromCart() flow never sets them (per-item
-- data now lives in order_items). Relax the NOT NULL constraints so both flows can insert.
ALTER TABLE public.orders
  ALTER COLUMN product_id DROP NOT NULL,
  ALTER COLUMN amount DROP NOT NULL;
