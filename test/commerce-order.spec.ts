import { beforeEach, describe, expect, it, vi } from 'vitest';

type QueryResult = {
  data: unknown;
  error: { message: string } | null;
};

const supabaseMock = vi.hoisted(() => ({
  inserts: [] as Array<{ table: string; values: unknown }>,
  updates: [] as Array<{ table: string; values: unknown }>,
  createClient: vi.fn(),
}));

vi.mock('@supabase/supabase-js', () => ({
  createClient: supabaseMock.createClient,
}));

import {
  createOrderFromCart,
  saveDeliveryAddressForCustomer,
} from '../src/commerce';

const customer = {
  id: 73,
  whatsapp_number: '919876543210',
  name: null,
  email: null,
  metadata: {},
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
};

const cart = {
  id: 12,
  customer_id: null,
  customer_phone: customer.whatsapp_number,
  status: 'active',
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
};

const cartItems = [{
  id: 21,
  cart_id: cart.id,
  product_id: 5,
  product_name: 'Test item',
  unit_price: 125,
  quantity: 2,
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
}];

const orderItems = [{
  id: 31,
  order_id: 42,
  product_id: 5,
  product_name: 'Test item',
  unit_price: 125,
  quantity: 2,
  line_total: 250,
  created_at: '2026-01-01T00:00:00.000Z',
}];

function createQuery(table: string) {
  let operation = 'select';
  let values: unknown;
  let result: QueryResult = { data: null, error: null };
  const query: Record<string, (...args: unknown[]) => unknown> = {};

  const resolve = (): QueryResult => {
    if (table === 'customers' && operation === 'select') {
      return { data: null, error: null };
    }
    if (table === 'customers' && operation === 'insert') {
      return { data: customer, error: null };
    }
    if (table === 'carts' && operation === 'select') {
      return { data: cart, error: null };
    }
    if (table === 'cart_items' && operation === 'select') {
      return { data: cartItems, error: null };
    }
    if (table === 'orders' && operation === 'insert') {
      const order = {
        id: 42,
        ...(values as Record<string, unknown>),
        razorpay_payment_link_id: null,
        razorpay_payment_link_url: null,
        razorpay_payment_id: null,
        paid_at: null,
        created_at: '2026-01-01T00:00:00.000Z',
        updated_at: '2026-01-01T00:00:00.000Z',
      };
      return { data: order, error: null };
    }
    if (table === 'delivery_addresses' && operation === 'insert') {
      return {
        data: {
          id: 99,
          customer_id: 73,
          ...(values as Record<string, unknown>),
        },
        error: null,
      };
    }
    if (table === 'delivery_addresses' && operation === 'update') {
      return {
        data: {
          id: 99,
          customer_id: 73,
          ...(values as Record<string, unknown>),
        },
        error: null,
      };
    }
    if (table === 'order_items' && operation === 'select') {
      return { data: orderItems, error: null };
    }
    return result;
  };

  query.select = () => query;
  query.eq = () => query;
  query.order = () => query;
  query.limit = () => query;
  query.maybeSingle = async () => resolve();
  query.single = async () => resolve();
  query.insert = (insertValues: unknown) => {
    operation = 'insert';
    values = insertValues;
    supabaseMock.inserts.push({ table, values: insertValues });
    return query;
  };
  query.update = (updateValues: unknown) => {
    operation = 'update';
    values = updateValues;
    supabaseMock.updates.push({ table, values: updateValues });
    return query;
  };
  query.then = (
    onFulfilled?: (value: QueryResult) => unknown,
    onRejected?: (reason: unknown) => unknown
  ) => Promise.resolve(resolve()).then(onFulfilled, onRejected);

  return query;
}

describe('createOrderFromCart', () => {
  beforeEach(() => {
    supabaseMock.inserts = [];
    supabaseMock.updates = [];
    supabaseMock.createClient.mockImplementation(() => ({
      from(table: string) {
        return createQuery(table);
      },
    }));
  });

  it('creates or resolves the customer and writes its id to the new order', async () => {
    const result = await createOrderFromCart(
      customer.whatsapp_number,
      {
        SUPABASE_URL: 'https://supabase.example.test',
        SUPABASE_SERVICE_ROLE_KEY: 'test-service-role-key',
        RAZORPAY_KEY_ID: 'test-key',
        RAZORPAY_KEY_SECRET: 'test-secret',
        RAZORPAY_WEBHOOK_SECRET: 'test-webhook-secret',
      } as Parameters<typeof createOrderFromCart>[1],
      'message-123'
    );

    const customerInsert = supabaseMock.inserts.find((insert) => insert.table === 'customers');
    const orderInsert = supabaseMock.inserts.find((insert) => insert.table === 'orders');

    expect(customerInsert?.values).toMatchObject({
      whatsapp_number: customer.whatsapp_number,
      metadata: {},
    });
    expect(orderInsert?.values).toMatchObject({
      customer_id: customer.id,
      customer_phone: customer.whatsapp_number,
      meta_message_id: 'message-123',
      status: 'pending',
      subtotal: 250,
      total_amount: 250,
    });
    expect(result.order.customer_id).toBe(customer.id);
    expect(result.orderItems).toEqual(orderItems);
  });
});

describe('saveDeliveryAddressForCustomer', () => {
  beforeEach(() => {
    supabaseMock.inserts = [];
    supabaseMock.updates = [];
    supabaseMock.createClient.mockImplementation(() => ({
      from(table: string) {
        return createQuery(table);
      },
    }));
  });

  it('always writes a non-null profile name with the validated address', async () => {
    const result = await saveDeliveryAddressForCustomer(73, {
      recipient_name: 'Robin',
      recipient_phone: '918878787878',
      address_line_1: '12 Example Road',
      city: 'Pune',
      state: 'Maharashtra',
      pincode: '411001',
    }, {
      SUPABASE_URL: 'https://supabase.example.test',
      SUPABASE_SERVICE_ROLE_KEY: 'test-service-role-key',
      SUPABASE_ANON_KEY: 'test-anon-key',
      OPENAI_API_KEY: 'test-openai-key',
    } as Parameters<typeof saveDeliveryAddressForCustomer>[2]);

    const addressInsert = supabaseMock.inserts.find(
      (insert) => insert.table === 'delivery_addresses'
    );
    expect(addressInsert?.values).toMatchObject({
      customer_id: 73,
      profile_name: 'Robin',
      recipient_name: 'Robin',
      is_default: false,
      is_active: true,
    });
    expect(result.profile_name).toBe('Robin');
  });

  it('updates only the explicitly selected customer address', async () => {
    const result = await saveDeliveryAddressForCustomer(73, {
      recipient_name: 'Robin',
      recipient_phone: '918878787878',
      address_line_1: '12 New Example Road',
      city: 'Pune',
      state: 'Maharashtra',
      pincode: '411001',
    }, {
      SUPABASE_URL: 'https://supabase.example.test',
      SUPABASE_SERVICE_ROLE_KEY: 'test-service-role-key',
      SUPABASE_ANON_KEY: 'test-anon-key',
      OPENAI_API_KEY: 'test-openai-key',
    } as Parameters<typeof saveDeliveryAddressForCustomer>[2], 99);

    expect(supabaseMock.updates).toContainEqual(expect.objectContaining({
      table: 'delivery_addresses',
      values: expect.objectContaining({
        customer_id: 73,
        profile_name: 'Robin',
        address_line_1: '12 New Example Road',
      }),
    }));
    expect(result.id).toBe(99);
  });
});
