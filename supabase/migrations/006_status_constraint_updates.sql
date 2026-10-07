-- Sprint 1: preserve all existing order statuses and add fulfillment status values.
-- This does not remove legacy values. It only adds the new fulfillment stages used by
-- admin-managed order lifecycle tracking and customer service workflows.

ALTER TABLE public.orders
  DROP CONSTRAINT IF EXISTS orders_status_check;

ALTER TABLE public.orders
  ADD CONSTRAINT orders_status_check
  CHECK (
    status IN (
      'pending',
      'payment_pending',
      'paid',
      'failed',
      'cancelled',
      'fulfilled',
      'PACKED',
      'SHIPPED',
      'OUT_FOR_DELIVERY',
      'DELIVERED'
    )
  );

-- Optional compatibility note:
-- Existing rows keep their historical values. The app may still read legacy statuses.
-- New fulfillment stages are additive for order progression and future admin updates.
