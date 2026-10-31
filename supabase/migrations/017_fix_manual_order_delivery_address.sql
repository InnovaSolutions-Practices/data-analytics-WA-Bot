CREATE OR REPLACE FUNCTION public.create_admin_order(
  p_customer_id BIGINT,
  p_product_id BIGINT,
  p_quantity INTEGER,
  p_unit_price NUMERIC,
  p_notes TEXT,
  p_delivery_address JSONB,
  p_initial_status TEXT DEFAULT 'pending'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  customer_row public.customers%ROWTYPE;
  product_row public.products%ROWTYPE;
  address_row public.delivery_addresses%ROWTYPE;
  order_row public.orders%ROWTYPE;
  item_row public.order_items%ROWTYPE;
  line_total NUMERIC(12, 2);
BEGIN
  IF p_quantity IS NULL OR p_quantity <= 0 THEN
    RAISE EXCEPTION 'Quantity must be a positive integer' USING ERRCODE = '22023';
  END IF;

  IF p_unit_price IS NULL OR p_unit_price < 0 THEN
    RAISE EXCEPTION 'Price must be zero or greater' USING ERRCODE = '22023';
  END IF;

  IF p_initial_status NOT IN (
    'pending', 'payment_pending', 'paid', 'failed', 'cancelled',
    'fulfilled', 'PACKED', 'SHIPPED', 'OUT_FOR_DELIVERY', 'DELIVERED'
  ) THEN
    RAISE EXCEPTION 'Unsupported initial order status' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO customer_row
  FROM public.customers
  WHERE id = p_customer_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Customer not found' USING ERRCODE = 'P0002';
  END IF;

  SELECT * INTO product_row
  FROM public.products
  WHERE id = p_product_id
    AND is_active = TRUE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Active product not found' USING ERRCODE = 'P0002';
  END IF;

  IF p_delivery_address IS NULL
     OR NULLIF(BTRIM(p_delivery_address ->> 'address_line_1'), '') IS NULL
     OR NULLIF(BTRIM(p_delivery_address ->> 'city'), '') IS NULL
     OR NULLIF(BTRIM(p_delivery_address ->> 'state'), '') IS NULL
     OR COALESCE(p_delivery_address ->> 'pincode', '') !~ '^[0-9]{6}$' THEN
    RAISE EXCEPTION 'A complete delivery address with a six-digit pincode is required'
      USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.delivery_addresses (
    customer_id, profile_name, recipient_name, recipient_phone, email,
    address_line_1, address_line_2, city, state, pincode, landmark,
    is_default, is_active
  ) VALUES (
    customer_row.id,
    COALESCE(NULLIF(BTRIM(p_delivery_address ->> 'profile_name'), ''), 'Delivery'),
    COALESCE(NULLIF(BTRIM(p_delivery_address ->> 'recipient_name'), ''), customer_row.name, 'Customer'),
    COALESCE(NULLIF(BTRIM(p_delivery_address ->> 'recipient_phone'), ''), customer_row.whatsapp_number),
    COALESCE(NULLIF(BTRIM(p_delivery_address ->> 'email'), ''), customer_row.email),
    BTRIM(p_delivery_address ->> 'address_line_1'),
    NULLIF(BTRIM(p_delivery_address ->> 'address_line_2'), ''),
    BTRIM(p_delivery_address ->> 'city'),
    BTRIM(p_delivery_address ->> 'state'),
    BTRIM(p_delivery_address ->> 'pincode'),
    NULLIF(BTRIM(p_delivery_address ->> 'landmark'), ''),
    FALSE,
    TRUE
  )
  RETURNING * INTO address_row;

  line_total := ROUND(p_unit_price * p_quantity, 2);

  INSERT INTO public.orders (
    customer_id, customer_phone, status, subtotal, tax, total_amount,
    currency, payment_provider, notes
  ) VALUES (
    customer_row.id, customer_row.whatsapp_number, p_initial_status,
    line_total, 0, line_total, 'INR', 'manual', NULLIF(BTRIM(p_notes), '')
  )
  RETURNING * INTO order_row;

  INSERT INTO public.order_items (
    order_id, product_id, product_name, unit_price, quantity, line_total
  ) VALUES (
    order_row.id, product_row.id, product_row.name,
    p_unit_price, p_quantity, line_total
  )
  RETURNING * INTO item_row;

  INSERT INTO public.order_status_history (
    order_id, previous_status, new_status, changed_by, changed_by_role, reason
  ) VALUES (
    order_row.id, NULL, p_initial_status, 'admin-manual', 'admin', 'Manual order created'
  );

  INSERT INTO public.order_delivery_details (
    order_id, delivery_address_id, customer_response, delivery_status
  ) VALUES (
    order_row.id, address_row.id, 'YES', 'READY_FOR_DELIVERY'
  );

  RETURN jsonb_build_object(
    'order', to_jsonb(order_row),
    'item', to_jsonb(item_row),
    'delivery_address', to_jsonb(address_row)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.create_admin_order(
  BIGINT, BIGINT, INTEGER, NUMERIC, TEXT, JSONB, TEXT
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.create_admin_order(
  BIGINT, BIGINT, INTEGER, NUMERIC, TEXT, JSONB, TEXT
) TO service_role;

NOTIFY pgrst, 'reload schema';
