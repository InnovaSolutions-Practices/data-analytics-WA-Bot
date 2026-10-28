import { getAdminClient, type OrderRecord, type ProductRecord } from './commerce';
import type { RAGEnv } from './rag';

export interface CommerceToolResult<T = unknown> {
  found: boolean;
  data: T | null;
  message?: string;
}

export interface CommerceOrder extends OrderRecord {
  order_items?: Array<{
    product_name: string;
    quantity: number;
    unit_price: number;
    line_total: number;
  }>;
}

export async function getLatestOrder(
  phoneNumber: string,
  env: RAGEnv
): Promise<CommerceToolResult<CommerceOrder>> {
  const { data, error } = await getAdminClient(env)
    .from('orders')
    .select('*, order_items(product_name, quantity, unit_price, line_total)')
    .eq('customer_phone', phoneNumber.trim())
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(`Commerce latest order lookup failed: ${error.message}`);
  }

  return {
    found: Boolean(data),
    data: (data as CommerceOrder | null) ?? null,
    message: data ? undefined : 'No orders were found for this customer.',
  };
}

export async function getOrderHistory(
  phoneNumber: string,
  env: RAGEnv
): Promise<CommerceToolResult<CommerceOrder[]>> {
  const { data, error } = await getAdminClient(env)
    .from('orders')
    .select('*, order_items(product_name, quantity, unit_price, line_total)')
    .eq('customer_phone', phoneNumber.trim())
    .order('created_at', { ascending: false });

  if (error) {
    throw new Error(`Commerce order history lookup failed: ${error.message}`);
  }

  const orders = (data as CommerceOrder[]) ?? [];
  return {
    found: orders.length > 0,
    data: orders,
    message: orders.length > 0 ? undefined : 'No order history was found for this customer.',
  };
}

export async function getProductDetails(
  productName: string,
  env: RAGEnv
): Promise<CommerceToolResult<ProductRecord>> {
  const query = productName.trim();
  if (!query) {
    return { found: false, data: null, message: 'A product name is required.' };
  }

  const { data, error } = await getAdminClient(env)
    .from('products')
    .select('*')
    .ilike('name', `%${query}%`)
    .eq('is_active', true)
    .order('name', { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(`Commerce product lookup failed: ${error.message}`);
  }

  return {
    found: Boolean(data),
    data: (data as ProductRecord | null) ?? null,
    message: data ? undefined : `No active product matched "${query}".`,
  };
}

export async function getInventory(
  productName: string,
  env: RAGEnv
): Promise<CommerceToolResult<Pick<ProductRecord, 'id' | 'name' | 'sku' | 'stock' | 'is_active'>>> {
  const product = await getProductDetails(productName, env);
  if (!product.data) {
    return product as CommerceToolResult<Pick<ProductRecord, 'id' | 'name' | 'sku' | 'stock' | 'is_active'>>;
  }

  return {
    found: true,
    data: {
      id: product.data.id,
      name: product.data.name,
      sku: product.data.sku,
      stock: product.data.stock,
      is_active: product.data.is_active,
    },
  };
}

export async function getPaymentInfo(
  orderId: number,
  env: RAGEnv
): Promise<CommerceToolResult<Pick<CommerceOrder, 'id' | 'status' | 'total_amount' | 'currency' | 'payment_provider' | 'razorpay_payment_link_id' | 'razorpay_payment_link_url' | 'razorpay_payment_id' | 'paid_at'>>> {
  const { data, error } = await getAdminClient(env)
    .from('orders')
    .select('id, status, total_amount, currency, payment_provider, razorpay_payment_link_id, razorpay_payment_link_url, razorpay_payment_id, paid_at')
    .eq('id', orderId)
    .maybeSingle();

  if (error) {
    throw new Error(`Commerce payment lookup failed: ${error.message}`);
  }

  return {
    found: Boolean(data),
    data: (data as Pick<CommerceOrder, 'id' | 'status' | 'total_amount' | 'currency' | 'payment_provider' | 'razorpay_payment_link_id' | 'razorpay_payment_link_url' | 'razorpay_payment_id' | 'paid_at'> | null) ?? null,
    message: data ? undefined : `Order ${orderId} was not found.`,
  };
}

export async function getInvoice(
  orderId: number,
  env: RAGEnv
): Promise<CommerceToolResult<{ order_id: number; invoice_available: false }>> {
  const payment = await getPaymentInfo(orderId, env);
  if (!payment.found) {
    return { found: false, data: null, message: payment.message };
  }

  return {
    found: false,
    data: { order_id: orderId, invoice_available: false },
    message: 'No invoice record is available for this order.',
  };
}