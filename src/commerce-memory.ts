import { getAdminClient } from './commerce';
import type { RAGEnv } from './rag';

export interface CommerceContextRecord {
  phone_number: string;
  last_product: string | null;
  last_order_id: number | null;
  last_intent: string | null;
  updated_at: string;
}

export interface CustomerProfileRecord {
  phone_number: string;
  total_orders: number;
  total_spent: number;
  favorite_category: string | null;
  favorite_product: string | null;
  last_order_id: number | null;
}

export async function getCommerceContext(
  phoneNumber: string,
  env: RAGEnv
): Promise<CommerceContextRecord | null> {
  const { data, error } = await getAdminClient(env)
    .from('conversation_context')
    .select('*')
    .eq('phone_number', phoneNumber.trim())
    .maybeSingle();

  if (error) {
    throw new Error(`Commerce context lookup failed: ${error.message}`);
  }

  return (data as CommerceContextRecord | null) ?? null;
}

export async function saveCommerceContext(
  phoneNumber: string,
  updates: Pick<CommerceContextRecord, 'last_product' | 'last_order_id' | 'last_intent'>,
  env: RAGEnv
): Promise<CommerceContextRecord> {
  const client = getAdminClient(env);
  const existing = await getCommerceContext(phoneNumber, env);
  const context = {
    phone_number: phoneNumber.trim(),
    last_product: updates.last_product ?? existing?.last_product ?? null,
    last_order_id: updates.last_order_id ?? existing?.last_order_id ?? null,
    last_intent: updates.last_intent ?? existing?.last_intent ?? null,
    updated_at: new Date().toISOString(),
  };

  const { data, error } = await client
    .from('conversation_context')
    .upsert(context, { onConflict: 'phone_number' })
    .select('*')
    .single();

  if (error || !data) {
    throw new Error(`Commerce context save failed: ${error?.message ?? 'Unknown error'}`);
  }

  console.log('[COMMERCE CONTEXT SAVED]', {
    phoneNumber: context.phone_number,
    lastProduct: context.last_product,
    lastOrderId: context.last_order_id,
    lastIntent: context.last_intent,
  });
  return data as CommerceContextRecord;
}

export function resolveCommerceReferences(
  context: CommerceContextRecord | null,
  intent: { intent: string; orderId: number | null; productName: string | null }
): { orderId: number | null; productName: string | null; usedContext: boolean } {
  const orderId = intent.orderId ?? (
    [
      'PAYMENT_QUERY',
      'INVOICE_QUERY',
      'DELIVERY_QUERY',
      'CANCEL_ORDER_QUERY',
      'RETURN_QUERY',
      'REFUND_QUERY',
    ].includes(intent.intent)
      ? context?.last_order_id ?? null
      : null
  );
  const productName = intent.productName ?? (
    ['PRODUCT_QUERY', 'INVENTORY_QUERY'].includes(intent.intent)
      ? context?.last_product ?? null
      : null
  );
  const usedContext = (
    intent.orderId === null && orderId !== null
  ) || (
    intent.productName === null && productName !== null
  );

  if (usedContext) {
    console.log('[COMMERCE CONTEXT USED]', {
      intent: intent.intent,
      lastProduct: productName,
      lastOrderId: orderId,
    });
  }

  if (orderId !== null && [
    'DELIVERY_QUERY',
    'CANCEL_ORDER_QUERY',
    'RETURN_QUERY',
    'REFUND_QUERY',
  ].includes(intent.intent)) {
    console.log('[COMMERCE CONTEXT ORDER]', {
      intent: intent.intent,
      orderId,
    });
  }

  return { orderId, productName, usedContext };
}

export async function getCustomerProfile(
  phoneNumber: string,
  env: RAGEnv
): Promise<CustomerProfileRecord | null> {
  const { data, error } = await getAdminClient(env)
    .from('customer_profiles')
    .select('*')
    .eq('phone_number', phoneNumber.trim())
    .maybeSingle();

  if (error) {
    throw new Error(`Customer profile lookup failed: ${error.message}`);
  }

  return (data as CustomerProfileRecord | null) ?? null;
}

export async function updateCustomerProfile(
  phoneNumber: string,
  env: RAGEnv
): Promise<CustomerProfileRecord | null> {
  const normalizedPhone = phoneNumber.trim();

  try {
    const client = getAdminClient(env);
    const { data: orders, error: ordersError } = await client
      .from('orders')
      .select('id, total_amount, created_at')
      .eq('customer_phone', normalizedPhone)
      .order('created_at', { ascending: false });

    if (ordersError) {
      console.error('[CUSTOMER PROFILE ENRICHMENT SKIPPED]', ordersError.message);
      return null;
    }

    const orderRows = orders ?? [];
    const orderIds = orderRows.map((order) => Number(order.id));
    let favoriteProduct: string | null = null;
    let favoriteCategory: string | null = null;

    try {
      const existingProfile = await getCustomerProfile(normalizedPhone, env);
      favoriteCategory = existingProfile?.favorite_category ?? null;
    } catch (error) {
      console.error('[CUSTOMER PROFILE ENRICHMENT SKIPPED]', error);
    }

    const { data: items, error: itemsError } = orderIds.length > 0
      ? await client
        .from('order_items')
        .select('product_id, product_name, quantity')
        .in('order_id', orderIds)
      : { data: [], error: null };

    if (itemsError) {
      console.error('[CUSTOMER PROFILE ENRICHMENT SKIPPED]', itemsError.message);
    }

    const orderItems = items ?? [];
    const productCounts = new Map<string, number>();
    for (const item of orderItems) {
      const productName = String(item.product_name ?? '').trim();
      const quantity = Number(item.quantity) || 0;
      if (productName) productCounts.set(productName, (productCounts.get(productName) ?? 0) + quantity);
    }
    favoriteProduct = [...productCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

    const productIds = [...new Set(
      orderItems
        .map((item) => Number(item.product_id))
        .filter((productId) => Number.isInteger(productId) && productId > 0)
    )];

    if (productIds.length > 0 && !itemsError) {
      try {
        const { data: products, error: productsError } = await client
          .from('products')
          .select('id, category')
          .in('id', productIds);

        if (productsError) {
          throw new Error(productsError.message);
        }

        const categoryCounts = new Map<string, number>();
        const quantityByProductId = new Map<number, number>();
        for (const item of orderItems) {
          const productId = Number(item.product_id);
          quantityByProductId.set(productId, (quantityByProductId.get(productId) ?? 0) + (Number(item.quantity) || 0));
        }
        for (const product of products ?? []) {
          const category = String(product.category ?? '').trim();
          const quantity = quantityByProductId.get(Number(product.id)) ?? 0;
          if (category) categoryCounts.set(category, (categoryCounts.get(category) ?? 0) + quantity);
        }
        favoriteCategory = [...categoryCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? favoriteCategory;
      } catch (error) {
        console.log('[CUSTOMER PROFILE CATEGORY SKIPPED]', {
          phoneNumber: normalizedPhone,
          reason: error instanceof Error ? error.message : String(error),
        });
      }
    } else {
      console.log('[CUSTOMER PROFILE CATEGORY SKIPPED]', {
        phoneNumber: normalizedPhone,
        reason: itemsError ? 'Order items unavailable' : 'No product IDs available for category lookup',
      });
    }

    const profile = {
      phone_number: normalizedPhone,
      total_orders: orderRows.length,
      total_spent: orderRows.reduce((sum, order) => sum + Number(order.total_amount || 0), 0),
      favorite_category: favoriteCategory,
      favorite_product: favoriteProduct,
      last_order_id: orderIds[0] ?? null,
    };
    const { data, error } = await client
      .from('customer_profiles')
      .upsert(profile, { onConflict: 'phone_number' })
      .select('*')
      .single();

    if (error || !data) {
      console.error('[CUSTOMER PROFILE ENRICHMENT SKIPPED]', error?.message ?? 'Unknown error');
      return null;
    }

    console.log('[CUSTOMER PROFILE UPDATED]', {
      phoneNumber: normalizedPhone,
      totalOrders: profile.total_orders,
      totalSpent: profile.total_spent,
      favoriteProduct: profile.favorite_product,
      favoriteCategory: profile.favorite_category,
    });
    return data as CustomerProfileRecord;
  } catch (error) {
    console.error('[CUSTOMER PROFILE ENRICHMENT SKIPPED]', {
      phoneNumber: normalizedPhone,
      reason: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

const PRODUCT_VARIANTS: Record<string, string> = {
  watch: 'Watch',
  watches: 'Watch',
  'smart watch': 'Watch',
  shirt: 'Shirt',
  shirts: 'Shirt',
  't-shirt': 'Shirt',
  shoe: 'Shoes',
  shoes: 'Shoes',
  bag: 'Bag',
  bags: 'Bag',
};

export async function resolveProductName(
  productName: string,
  env: RAGEnv
): Promise<string | null> {
  const requested = productName.trim().toLowerCase();
  if (!requested) return null;

  const canonical = PRODUCT_VARIANTS[requested] ?? productName.trim();
  const { data, error } = await getAdminClient(env)
    .from('products')
    .select('name')
    .eq('is_active', true)
    .ilike('name', `%${canonical}%`)
    .order('name', { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.log('[PRODUCT RESOLUTION]', {
      requested: productName,
      canonical,
      resolved: null,
      reason: error.message,
    });
    return null;
  }

  const resolved = typeof data?.name === 'string' ? data.name : null;
  console.log('[PRODUCT RESOLUTION]', {
    requested: productName,
    canonical,
    resolved,
  });
  return resolved;
}