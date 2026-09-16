import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import {
  buildContext,
  extractAIText,
  normalizeSearchText,
  type ConversationState,
  type RAGContextItem,
  type RAGEnv,
} from './rag';

export interface CustomerRecord {
  id: number;
  whatsapp_number: string;
  name: string | null;
  email: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface ProductRecord {
  id: number;
  name: string;
  sku: string | null;
  description: string | null;
  category: string | null;
  price: number;
  stock: number;
  is_active: boolean;
  metadata: Record<string, unknown>;
}

export interface CartRecord {
  id: number;
  customer_id: number | null;
  customer_phone: string;
  status: string;
  created_at: string;
  updated_at: string;
}

export interface CartItemRecord {
  id: number;
  cart_id: number;
  product_id: number;
  product_name: string;
  unit_price: number;
  quantity: number;
  created_at: string;
  updated_at: string;
}

export interface OrderRecord {
  id: number;
  customer_id: number | null;
  customer_phone: string;
  meta_message_id: string | null;
  status: string;
  subtotal: number;
  tax: number;
  total_amount: number;
  currency: string;
  payment_provider: string;
  razorpay_payment_link_id: string | null;
  razorpay_payment_link_url: string | null;
  razorpay_payment_id: string | null;
  paid_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface OrderItemRecord {
  id: number;
  order_id: number;
  product_id: number | null;
  product_name: string;
  unit_price: number;
  quantity: number;
  line_total: number;
  created_at: string;
}

export interface ConversationStateRecord {
  id: number;
  whatsapp_number: string;
  state: ConversationState;
  context: Record<string, unknown>;
  last_message: string | null;
  created_at: string;
  updated_at: string;
}

export interface CommerceEnv extends RAGEnv {
  RAZORPAY_KEY_ID: string;
  RAZORPAY_KEY_SECRET: string;
  RAZORPAY_WEBHOOK_SECRET: string;
}

export function getAdminClient(env: RAGEnv): SupabaseClient {
  return createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

export async function upsertCustomer(
  whatsappNumber: string,
  env: RAGEnv,
  name?: string | null,
  email?: string | null
): Promise<CustomerRecord> {
  const client = getAdminClient(env);
  const trimmedPhone = whatsappNumber.trim();

  const { data: existing, error: lookupError } = await client
    .from('customers')
    .select('*')
    .eq('whatsapp_number', trimmedPhone)
    .maybeSingle();

  if (lookupError) {
    throw new Error(`Customer lookup failed: ${lookupError.message}`);
  }

  if (existing) {
    if (name || email) {
      const { data, error } = await client
        .from('customers')
        .update({
          name: name ?? existing.name,
          email: email ?? existing.email,
          updated_at: new Date().toISOString(),
        })
        .eq('id', existing.id)
        .select('*')
        .single();

      if (error || !data) {
        throw new Error(`Customer update failed: ${error?.message ?? 'Unknown error'}`);
      }

      return data as CustomerRecord;
    }

    return existing as CustomerRecord;
  }

  const { data, error } = await client
    .from('customers')
    .insert({
      whatsapp_number: trimmedPhone,
      name: name ?? null,
      email: email ?? null,
      metadata: {},
    })
    .select('*')
    .single();

  if (error || !data) {
    throw new Error(`Customer creation failed: ${error?.message ?? 'Unknown error'}`);
  }

  return data as CustomerRecord;
}

export async function getActiveCart(
  whatsappNumber: string,
  env: RAGEnv
): Promise<CartRecord | null> {
  const client = getAdminClient(env);
  const { data, error } = await client
    .from('carts')
    .select('*')
    .eq('customer_phone', whatsappNumber)
    .eq('status', 'active')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(`Active cart lookup failed: ${error.message}`);
  }

  return (data as CartRecord | null) ?? null;
}

export async function createCart(
  whatsappNumber: string,
  env: RAGEnv
): Promise<CartRecord> {
  const client = getAdminClient(env);
  const existing = await getActiveCart(whatsappNumber, env);
  if (existing) {
    return existing;
  }

  const { data, error } = await client
    .from('carts')
    .insert({
      customer_phone: whatsappNumber,
      status: 'active',
    })
    .select('*')
    .single();

  if (error || !data) {
    throw new Error(`Cart creation failed: ${error?.message ?? 'Unknown error'}`);
  }

  return data as CartRecord;
}

export async function getCartItems(
  cartId: number,
  env: RAGEnv
): Promise<CartItemRecord[]> {
  const client = getAdminClient(env);
  const { data, error } = await client
    .from('cart_items')
    .select('*')
    .eq('cart_id', cartId)
    .order('id', { ascending: true });

  if (error) {
    throw new Error(`Cart item query failed: ${error.message}`);
  }

  return (data as CartItemRecord[]) ?? [];
}

export function calculateCartTotal(items: CartItemRecord[]): number {
  return items.reduce((sum, item) => sum + Number(item.unit_price) * item.quantity, 0);
}

export async function addItemToCart(
  whatsappNumber: string,
  productId: number,
  quantity = 1,
  env: RAGEnv
): Promise<CartRecord> {
  const client = getAdminClient(env);
  console.log('Requested product id:', productId);
  const productQuery = await client
    .from('products')
    .select('*')
    .eq('id', productId)
    .maybeSingle();

  console.log('Supabase product query:', {
    table: 'products',
    select: '*',
    filter: { id: productId },
    singleResult: 'maybeSingle',
    error: productQuery.error,
  });

  if (productQuery.error) {
    throw new Error(`Product lookup failed: ${productQuery.error.message}`);
  }

  const product = productQuery.data as ProductRecord | null;
  console.log('Product lookup result:', product);
  if (!product) {
    throw new Error('Product not found');
  }

  if (!product.is_active) {
    console.log('Product lookup result:', product);
    console.log('Requested product id:', productId);
    throw new Error('Product is not available');
  }

  const cart = await createCart(whatsappNumber, env);
  const currentItems = await getCartItems(cart.id, env);
  const existing = currentItems.find((item) => item.product_id === product.id);

  const nextQuantity = (existing?.quantity ?? 0) + quantity;
  if (nextQuantity > product.stock) {
    throw new Error(`Only ${product.stock} units of ${product.name} are available.`);
  }

  if (existing) {
    const { error } = await client
      .from('cart_items')
      .update({
        quantity: nextQuantity,
        unit_price: Number(product.price),
        product_name: product.name,
        updated_at: new Date().toISOString(),
      })
      .eq('id', existing.id);

    if (error) {
      throw new Error(`Update cart item failed: ${error.message}`);
    }
  } else {
    const { error } = await client.from('cart_items').insert({
      cart_id: cart.id,
      product_id: product.id,
      product_name: product.name,
      unit_price: Number(product.price),
      quantity,
    });

    if (error) {
      throw new Error(`Insert cart item failed: ${error.message}`);
    }
  }

  const { data: refreshedCart, error: cartError } = await client
    .from('carts')
    .update({
      updated_at: new Date().toISOString(),
    })
    .eq('id', cart.id)
    .select('*')
    .single();

  if (cartError || !refreshedCart) {
    throw new Error(`Cart refresh failed: ${cartError?.message ?? 'Unknown error'}`);
  }

  return refreshedCart as CartRecord;
}

export async function removeItemFromCart(
  whatsappNumber: string,
  productId: number,
  env: RAGEnv
): Promise<void> {
  const client = getAdminClient(env);
  const cart = await getActiveCart(whatsappNumber, env);
  if (!cart) {
    return;
  }

  const { error } = await client
    .from('cart_items')
    .delete()
    .eq('cart_id', cart.id)
    .eq('product_id', productId);

  if (error) {
    throw new Error(`Remove cart item failed: ${error.message}`);
  }
}

export async function updateCartItemQuantity(
  whatsappNumber: string,
  productId: number,
  quantity: number,
  env: RAGEnv
): Promise<void> {
  if (quantity <= 0) {
    await removeItemFromCart(whatsappNumber, productId, env);
    return;
  }

  const client = getAdminClient(env);
  const cart = await getActiveCart(whatsappNumber, env);
  if (!cart) {
    return;
  }

  const productQuery = await client
    .from('products')
    .select('*')
    .eq('id', productId)
    .maybeSingle();

  if (productQuery.error) {
    throw new Error(`Product lookup failed: ${productQuery.error.message}`);
  }

  const product = productQuery.data as ProductRecord | null;
  if (!product) {
    throw new Error('Product not found');
  }

  if (quantity > product.stock) {
    throw new Error(`Only ${product.stock} units of ${product.name} are available.`);
  }

  const { error } = await client
    .from('cart_items')
    .update({ quantity, updated_at: new Date().toISOString() })
    .eq('cart_id', cart.id)
    .eq('product_id', productId);

  if (error) {
    throw new Error(`Cart quantity update failed: ${error.message}`);
  }
}

export async function viewCart(
  whatsappNumber: string,
  env: RAGEnv
): Promise<{ cart: CartRecord | null; items: CartItemRecord[]; total: number }> {
  const cart = await getActiveCart(whatsappNumber, env);
  if (!cart) {
    return { cart: null, items: [], total: 0 };
  }

  const items = await getCartItems(cart.id, env);
  return { cart, items, total: calculateCartTotal(items) };
}

export async function clearCart(
  whatsappNumber: string,
  env: RAGEnv
): Promise<void> {
  const cart = await getActiveCart(whatsappNumber, env);
  if (!cart) {
    return;
  }

  const client = getAdminClient(env);
  const { error } = await client
    .from('cart_items')
    .delete()
    .eq('cart_id', cart.id);

  if (error) {
    throw new Error(`Clear cart failed: ${error.message}`);
  }

  await client
    .from('carts')
    .update({ status: 'closed', updated_at: new Date().toISOString() })
    .eq('id', cart.id);
}

export async function createOrderFromCart(
  whatsappNumber: string,
  env: CommerceEnv,
  metaMessageId?: string
): Promise<{ order: OrderRecord; orderItems: OrderItemRecord[] }> {
  const cart = await getActiveCart(whatsappNumber, env);
  if (!cart) {
    throw new Error('Cart not found');
  }

  const items = await getCartItems(cart.id, env);
  if (!items.length) {
    throw new Error('Cart is empty');
  }

  const client = getAdminClient(env);
  const subtotal = calculateCartTotal(items);
  const orderInsert = await client
    .from('orders')
    .insert({
      customer_phone: whatsappNumber,
      meta_message_id: metaMessageId ?? null,
      status: 'pending',
      subtotal,
      tax: 0,
      total_amount: subtotal,
      currency: 'INR',
      payment_provider: 'razorpay',
    })
    .select('*')
    .single();

  if (orderInsert.error || !orderInsert.data) {
    throw new Error(`Order creation failed: ${orderInsert.error?.message ?? 'Unknown error'}`);
  }

  const order = orderInsert.data as OrderRecord;
  const orderItems = items.map((item) => ({
    order_id: order.id,
    product_id: item.product_id,
    product_name: item.product_name,
    unit_price: Number(item.unit_price),
    quantity: item.quantity,
    line_total: Number(item.unit_price) * item.quantity,
  }));

  const { error: itemError } = await client.from('order_items').insert(orderItems);
  if (itemError) {
    throw new Error(`Order item creation failed: ${itemError.message}`);
  }

  await client
    .from('carts')
    .update({ status: 'checked_out', updated_at: new Date().toISOString() })
    .eq('id', cart.id);

  const { data: refreshedOrderItems, error: refreshedItemsError } = await client
    .from('order_items')
    .select('*')
    .eq('order_id', order.id)
    .order('id', { ascending: true });

  if (refreshedItemsError) {
    throw new Error(`Order item retrieval failed: ${refreshedItemsError.message}`);
  }

  return {
    order,
    orderItems: (refreshedOrderItems as OrderItemRecord[]) ?? [],
  };
}

export async function createRazorpayPaymentLink(
  order: OrderRecord,
  env: CommerceEnv
): Promise<{ id: string; short_url: string }> {
  const basicAuth = btoa(`${env.RAZORPAY_KEY_ID}:${env.RAZORPAY_KEY_SECRET}`);
  const response = await fetch('https://api.razorpay.com/v1/payment_links', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basicAuth}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      amount: Math.round(Number(order.total_amount) * 100),
      currency: 'INR',
      description: `Payment for order #${order.id}`,
      customer: {
        contact: `+${order.customer_phone}`,
      },
      notify: {
        sms: false,
        email: false,
      },
      reminder_enable: false,
      reference_id: `order_${order.id}`,
      notes: {
        order_id: String(order.id),
        customer_phone: order.customer_phone,
      },
    }),
  });

  const payload = await response.json() as { id?: string; short_url?: string; error?: { description?: string } };
  if (!response.ok || !payload.id || !payload.short_url) {
    throw new Error(payload.error?.description ?? 'Could not generate Razorpay payment link');
  }

  return {
    id: payload.id,
    short_url: payload.short_url,
  };
}

export async function updateOrderPaymentLink(
  orderId: number,
  linkId: string,
  linkUrl: string,
  env: RAGEnv
): Promise<void> {
  const client = getAdminClient(env);
  const { error } = await client
    .from('orders')
    .update({
      status: 'payment_pending',
      razorpay_payment_link_id: linkId,
      razorpay_payment_link_url: linkUrl,
      updated_at: new Date().toISOString(),
    })
    .eq('id', orderId);

  if (error) {
    throw new Error(`Order payment link update failed: ${error.message}`);
  }
}

export async function processSuccessfulPayment(
  rawBody: string,
  signature: string,
  env: CommerceEnv
): Promise<{ ok: boolean; orderId?: number }> {
  const expectedSignature = await createRazorpaySignature(rawBody, env.RAZORPAY_WEBHOOK_SECRET);
  const isValid = safeCompare(expectedSignature, signature);
  if (!isValid) {
    throw new Error('Invalid Razorpay signature');
  }

  const event = JSON.parse(rawBody) as {
    event?: string;
    payload?: {
      payment?: { entity?: { id?: string; amount?: number } };
      payment_link?: { entity?: { id?: string; amount_paid?: number } };
    };
    created_at?: number;
  };

  if (event.event !== 'payment_link.paid') {
    return { ok: true };
  }

  const paymentLinkId = event.payload?.payment_link?.entity?.id;
  if (!paymentLinkId) {
    throw new Error('Missing payment link ID in webhook payload');
  }

  const client = getAdminClient(env);
  const { data: order, error } = await client
    .from('orders')
    .select('*')
    .eq('razorpay_payment_link_id', paymentLinkId)
    .maybeSingle();

  if (error) {
    throw new Error(`Order lookup failed: ${error.message}`);
  }

  if (!order) {
    throw new Error('No order found for the payment link');
  }

  const paymentAmount = Number(event.payload?.payment?.entity?.amount ?? event.payload?.payment_link?.entity?.amount_paid ?? 0);
  const expectedAmount = Math.round(Number((order as OrderRecord).total_amount) * 100);
  if (paymentAmount !== expectedAmount) {
    throw new Error(`Payment amount mismatch: expected ${expectedAmount}, received ${paymentAmount}`);
  }

  const { data: updatedOrder, error: paymentError } = await client
    .from('orders')
    .update({
      status: 'paid',
      razorpay_payment_id: event.payload?.payment?.entity?.id ?? null,
      paid_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', order.id)
    .select('*')
    .single();

  if (paymentError || !updatedOrder) {
    throw new Error(`Order payment update failed: ${paymentError?.message ?? 'Unknown error'}`);
  }

  return { ok: true, orderId: Number(updatedOrder.id) };
}

export async function upsertConversationState(
  whatsappNumber: string,
  state: ConversationState,
  env: RAGEnv,
  context: Record<string, unknown> = {},
  lastMessage?: string | null
): Promise<ConversationStateRecord> {
  const client = getAdminClient(env);
  const { data, error } = await client
    .from('conversation_state')
    .upsert(
      {
        whatsapp_number: whatsappNumber,
        state,
        context,
        last_message: lastMessage ?? null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'whatsapp_number' }
    )
    .select('*')
    .single();

  if (error || !data) {
    throw new Error(`Conversation state update failed: ${error?.message ?? 'Unknown error'}`);
  }

  return data as ConversationStateRecord;
}

export async function logInteraction(
  whatsappNumber: string,
  message: string,
  retrievedDocuments: RAGContextItem[],
  selectedContext: Record<string, unknown>,
  generatedAnswer: string,
  state: ConversationState,
  env: RAGEnv
): Promise<ConversationStateRecord> {
  const context = {
    incoming_message: message,
    retrieved_documents: retrievedDocuments,
    selected_context: selectedContext,
    generated_answer: generatedAnswer,
  };

  return upsertConversationState(whatsappNumber, state, env, context, message);
}

export async function searchKnowledgeBase(
  query: string,
  env: RAGEnv,
  limit = 5
): Promise<RAGContextItem[]> {
  const client = getAdminClient(env);
  const cleaned = normalizeSearchText(query);
  if (!cleaned) {
    return [];
  }

  const terms = cleaned.split(' ').filter((term) => term.length > 2).slice(0, 6);
  if (!terms.length) {
    return [];
  }

  const orClause = terms
    .map((term) => `title.ilike.%${term}%,content.ilike.%${term}%`)
    .join(',');

  const { data, error } = await client
    .from('knowledge_base')
    .select('*')
    .or(orClause)
    .limit(limit);

  if (error) {
    console.warn('Knowledge base lookup failed:', error.message);
    return [];
  }

  if (!data || !data.length) {
    return [];
  }

  return (data as Array<{ title: string; content: string; source_type?: string; category?: string }>).map((item) => ({
    title: item.title ?? 'Knowledge article',
    content: item.content ?? '',
    source: item.source_type ?? item.category ?? 'knowledge-base',
    score: 1,
  }));
}

export async function generateAnswer(
  question: string,
  env: RAGEnv,
  whatsappNumber?: string,
  state: ConversationState = 'MAIN_MENU'
): Promise<string> {
  const docs = await searchKnowledgeBase(question, env, 5);
  const prompt = buildContext(docs, question);

  if (!docs.length) {
    const fallback = 'I do not have verified information for that yet. Please contact Customer Care for assistance.';
    if (whatsappNumber) {
      await logInteraction(whatsappNumber, question, [], {}, fallback, state, env);
    }
    return fallback;
  }

  try {
    const result = await env.AI.run('@cf/meta/llama-3.1-8b-instruct-fast', {
      messages: [
        {
          role: 'system',
          content: 'You are the Innova Solutions commerce assistant. Answer using only the supplied knowledge base context. Keep the reply under 500 characters and never invent product or payment details.',
        },
        {
          role: 'user',
          content: prompt,
        },
      ],
      max_tokens: 200,
    });

    const answer = extractAIText(result)?.trim() ?? 'I do not have verified information for that yet.';
    if (whatsappNumber) {
      await logInteraction(whatsappNumber, question, docs, { selected_documents: docs.slice(0, 3) }, answer, state, env);
    }
    return answer.slice(0, 500);
  } catch (error) {
    console.error('AI answer generation failed:', error);
    const fallback = 'I do not have verified information for that yet. Please contact Customer Care for assistance.';
    if (whatsappNumber) {
      await logInteraction(whatsappNumber, question, docs, { selected_documents: docs.slice(0, 3) }, fallback, state, env);
    }
    return fallback;
  }
}

function bytesToHex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

function safeCompare(expected: string, actual: string): boolean {
  if (expected.length !== actual.length) {
    return false;
  }

  let difference = 0;
  for (let index = 0; index < expected.length; index += 1) {
    difference |= expected.charCodeAt(index) ^ actual.charCodeAt(index);
  }
  return difference === 0;
}

async function createRazorpaySignature(rawBody: string, secret: string): Promise<string> {
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );

  const signature = await crypto.subtle.sign('HMAC', cryptoKey, new TextEncoder().encode(rawBody));
  return bytesToHex(signature).toLowerCase();
}

export async function handleRazorpaySuccessWebhook(
  rawBody: string,
  signature: string,
  env: CommerceEnv
): Promise<{ ok: boolean; orderId?: number }> {
  const expectedSignature = await createRazorpaySignature(rawBody, env.RAZORPAY_WEBHOOK_SECRET);
  const isValid = safeCompare(expectedSignature, signature.toLowerCase());
  if (!isValid) {
    throw new Error('Invalid Razorpay webhook signature');
  }

  const event = JSON.parse(rawBody) as {
    event?: string;
    payload?: {
      payment?: { entity?: { id?: string; amount?: number } };
      payment_link?: { entity?: { id?: string } };
    };
  };

  if (event.event !== 'payment_link.paid') {
    return { ok: true };
  }

  const linkId = event.payload?.payment_link?.entity?.id;
  if (!linkId) {
    throw new Error('Payment link ID is missing from webhook payload');
  }

  const client = getAdminClient(env);
  const { data: order, error } = await client
    .from('orders')
    .select('*')
    .eq('razorpay_payment_link_id', linkId)
    .maybeSingle();

  if (error) {
    throw new Error(`Order lookup for payment failed: ${error.message}`);
  }

  if (!order) {
    throw new Error('Order not found for payment link');
  }

  const paymentEntity = event.payload?.payment?.entity ?? {};
  const { error: updateError } = await client
    .from('orders')
    .update({
      status: 'paid',
      razorpay_payment_id: paymentEntity.id ?? null,
      paid_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', order.id);

  if (updateError) {
    throw new Error(`Order payment completion failed: ${updateError.message}`);
  }

  return { ok: true, orderId: Number(order.id) };
}
