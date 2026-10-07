import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import {
  generateAnswerFromContext,
  retrieveKnowledgeContext,
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

export type SupportTicketStatus =
  | 'OPEN'
  | 'IN_PROGRESS'
  | 'WAITING_CUSTOMER'
  | 'WAITING_AGENT'
  | 'RESOLVED'
  | 'CLOSED';

export const SUPPORT_TICKET_STATUSES: readonly SupportTicketStatus[] = [
  'OPEN',
  'IN_PROGRESS',
  'WAITING_CUSTOMER',
  'WAITING_AGENT',
  'RESOLVED',
  'CLOSED',
];

export type SupportTicketPriority = 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT';

export interface SupportTicketRecord {
  id: number;
  ticket_number: string;
  customer_id: number | null;
  customer_phone: string;
  order_id: number | null;
  issue_type: string;
  issue_description: string | null;
  product_name: string | null;
  preferred_resolution: string | null;
  priority: SupportTicketPriority;
  status: SupportTicketStatus;
  created_at: string;
  updated_at: string;
  resolved_at: string | null;
}

export type SupportMessageSenderType = 'CUSTOMER' | 'AGENT';

export interface SupportMessageRecord {
  id: number;
  ticket_id: number;
  sender_type: SupportMessageSenderType;
  sender_id: string | null;
  message_text: string;
  created_at: string;
}

export type SupportAgentSessionStatus = 'WAITING_FOR_AGENT' | 'ACTIVE' | 'CLOSED';

export interface SupportAgentSessionRecord {
  id: number;
  ticket_id: number;
  customer_phone: string;
  agent_id: string | null;
  status: SupportAgentSessionStatus;
}

export type SupportSessionStatus =
  | 'DRAFT'
  | 'COLLECTING_INFO'
  | 'READY_FOR_ACTION'
  | 'TICKET_CREATED'
  | 'WAITING_AGENT'
  | 'CLOSED'
  | 'CANCELLED'
  | 'EXPIRED';

export type SupportSessionStep =
  | 'ASK_PRODUCT'
  | 'ASK_ISSUE'
  | 'ASK_RESOLUTION'
  | 'ASK_IMAGE'
  | 'WAITING_USER_DECISION';

export interface SupportSessionRecord {
  id: number;
  customer_phone: string;
  customer_id: number | null;
  order_id: number | null;
  issue_type: string;
  status: SupportSessionStatus;
  current_step: SupportSessionStep;
  product_name: string | null;
  issue_description: string | null;
  preferred_resolution: string | null;
  summary_text: string | null;
  collected_data: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface CreateSupportSessionInput {
  customerId?: number | null;
  customerPhone: string;
  orderId?: number | null;
  issueType: string;
  currentStep?: SupportSessionStep;
  productName?: string | null;
  issueDescription?: string | null;
  preferredResolution?: string | null;
  summaryText?: string | null;
  collectedData?: Record<string, unknown>;
}

export function normalizeSupportSessionAnswer(value: string): string {
  return value.trim().toLowerCase();
}

export function isAffirmativeAnswer(value: string): boolean {
  const normalized = normalizeSupportSessionAnswer(value);
  return /^(yes|y|yeah|yep|correct|sure|affirmative)(?:\b|\s|,)/.test(normalized);
}

export function isNegativeAnswer(value: string): boolean {
  const normalized = normalizeSupportSessionAnswer(value);
  return ['no', 'n', 'nope', 'nah', 'negative'].includes(normalized);
}

export function isSupportSessionReady(session: Pick<SupportSessionRecord, 'product_name' | 'issue_description' | 'preferred_resolution' | 'collected_data'>): boolean {
  const collected = session.collected_data ?? {};

  return Boolean(
    session.product_name &&
    session.issue_description &&
    session.preferred_resolution &&
    (
      Boolean(collected.product_confirmed) ||
      Boolean(collected.product_name) ||
      Boolean(collected.issue_description) ||
      Boolean(collected.preferred_resolution)
    )
  );
}

export async function createSupportSession(
  input: CreateSupportSessionInput,
  env: RAGEnv
): Promise<SupportSessionRecord> {
  const client = getAdminClient(env);
  const { data, error } = await client
    .from('support_sessions')
    .insert({
      customer_phone: input.customerPhone.trim(),
      customer_id: input.customerId ?? null,
      order_id: input.orderId ?? null,
      issue_type: input.issueType.trim(),
      status: 'DRAFT',
      current_step: input.currentStep ?? 'ASK_PRODUCT',
      product_name: input.productName ?? null,
      issue_description: input.issueDescription ?? null,
      preferred_resolution: input.preferredResolution ?? null,
      summary_text: input.summaryText ?? null,
      collected_data: input.collectedData ?? {},
    })
    .select('*')
    .single();

  if (error || !data) {
    throw new Error(`Support session creation failed: ${error?.message ?? 'Unknown error'}`);
  }

  return data as SupportSessionRecord;
}

export async function getActiveSupportSession(
  phoneNumber: string,
  env: RAGEnv
): Promise<SupportSessionRecord | null> {
  const client = getAdminClient(env);
  const { data, error } = await client
    .from('support_sessions')
    .select('*')
    .eq('customer_phone', phoneNumber.trim())
    .in('status', ['DRAFT', 'COLLECTING_INFO'])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(`Active support session lookup failed: ${error.message}`);
  }

  const session = (data as SupportSessionRecord | null) ?? null;
  if (session) {
    console.log('[SUPPORT SESSION MATCH]', {
      sessionId: session.id,
      phoneNumber: phoneNumber.trim(),
      status: session.status,
      currentStep: session.current_step,
    });
  }

  return session;
}

export async function getLatestTicketCreatedSupportSession(
  phoneNumber: string,
  env: RAGEnv
): Promise<SupportSessionRecord | null> {
  const client = getAdminClient(env);
  const { data, error } = await client
    .from('support_sessions')
    .select('*')
    .eq('customer_phone', phoneNumber.trim())
    .eq('status', 'TICKET_CREATED')
    .order('id', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(`Ticket-created support session lookup failed: ${error.message}`);
  }

  return (data as SupportSessionRecord | null) ?? null;
}

export async function updateSupportSession(
  sessionId: number,
  updates: Partial<Pick<SupportSessionRecord, 'status' | 'current_step' | 'product_name' | 'issue_description' | 'preferred_resolution' | 'summary_text' | 'collected_data'>>,
  env: RAGEnv
): Promise<SupportSessionRecord> {
  const client = getAdminClient(env);
  const { data, error } = await client
    .from('support_sessions')
    .update({
      ...updates,
      updated_at: new Date().toISOString(),
    })
    .eq('id', sessionId)
    .select('*')
    .single();

  if (error || !data) {
    throw new Error(`Support session update failed: ${error?.message ?? 'Unknown error'}`);
  }

  return data as SupportSessionRecord;
}

export async function attachSupportSessionMedia(
  sessionId: number,
  imageId: string,
  imageUrl: string | null,
  mimeType: string | null,
  env: RAGEnv
): Promise<void> {
  const client = getAdminClient(env);
  const { error } = await client
    .from('support_session_media')
    .insert({
      support_session_id: sessionId,
      media_id: imageId,
      image_url: imageUrl ?? null,
      mime_type: mimeType ?? null,
    });

  if (error) {
    throw new Error(`Support session media insert failed: ${error.message}`);
  }
}

export async function createTicketFromSupportSession(
  session: SupportSessionRecord,
  env: RAGEnv
): Promise<SupportTicketRecord> {
  if (!isSupportSessionReady(session)) {
    throw new Error('Support session is not ready to convert into a ticket');
  }

  if (typeof session.collected_data.image_url === 'string') {
    console.log('[SUPPORT TICKET IMAGE FIELD SKIPPED]', {
      sessionId: session.id,
      reason: 'support_tickets.image_url is not present in the deployed schema',
    });
  }

  console.log('[SUPPORT SESSION CLOSED_AT SKIPPED]', {
    sessionId: session.id,
    reason: 'support_sessions.closed_at is not present in the deployed schema',
  });

  const ticket = await createSupportTicket(
    {
      customerId: session.customer_id ?? null,
      customerPhone: session.customer_phone,
      orderId: session.order_id ?? null,
      issueType: session.issue_type,
      issueDescription: session.issue_description,
      productName: session.product_name,
      preferredResolution: session.preferred_resolution,
      priority: 'NORMAL',
    },
    env
  );

  await updateSupportSession(
    session.id,
    {
      status: 'TICKET_CREATED',
      current_step: 'WAITING_USER_DECISION',
      summary_text: session.summary_text ?? session.issue_description ?? 'Support session converted to ticket',
    },
    env
  );

  return ticket;
}

export interface CreateSupportTicketInput {
  customerId?: number | null;
  customerPhone: string;
  orderId?: number | null;
  issueType: string;
  issueDescription?: string | null;
  productName?: string | null;
  preferredResolution?: string | null;
  priority?: SupportTicketPriority;
  ticketNumber?: string;
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

export type OrderStatus =
  | 'pending'
  | 'payment_pending'
  | 'paid'
  | 'failed'
  | 'cancelled'
  | 'fulfilled'
  | 'PACKED'
  | 'SHIPPED'
  | 'OUT_FOR_DELIVERY'
  | 'DELIVERED';

export interface OrderStatusHistoryRecord {
  id: number;
  order_id: number;
  previous_status: OrderStatus | null;
  new_status: OrderStatus;
  changed_by: string | null;
  changed_by_role: string;
  reason: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface UpdateOrderStatusOptions {
  changedBy?: string | null;
  changedByRole?: string;
  reason?: string | null;
  metadata?: Record<string, unknown>;
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

const ORDER_STATUS_TRANSITIONS: Record<OrderStatus, readonly OrderStatus[]> = {
  pending: ['payment_pending', 'paid', 'failed', 'cancelled'],
  payment_pending: ['paid', 'failed', 'cancelled'],
  paid: ['PACKED', 'fulfilled', 'cancelled'],
  failed: ['payment_pending', 'cancelled'],
  cancelled: [],
  fulfilled: [],
  PACKED: ['SHIPPED', 'cancelled'],
  SHIPPED: ['OUT_FOR_DELIVERY', 'cancelled'],
  OUT_FOR_DELIVERY: ['DELIVERED', 'cancelled'],
  DELIVERED: [],
};

export function validateStatusTransition(
  currentStatus: string,
  nextStatus: string
): boolean {
  if (!(currentStatus in ORDER_STATUS_TRANSITIONS) || !(nextStatus in ORDER_STATUS_TRANSITIONS)) {
    return false;
  }

  if (currentStatus === nextStatus) {
    return true;
  }

  return ORDER_STATUS_TRANSITIONS[currentStatus as OrderStatus].includes(nextStatus as OrderStatus);
}

export async function getOrderStatus(
  orderId: number,
  env: RAGEnv
): Promise<OrderStatus> {
  const client = getAdminClient(env);
  const { data, error } = await client
    .from('orders')
    .select('status')
    .eq('id', orderId)
    .maybeSingle();

  if (error) {
    throw new Error(`Order status lookup failed: ${error.message}`);
  }

  if (!data) {
    throw new Error('Order not found');
  }

  const status = String(data.status);
  if (!(status in ORDER_STATUS_TRANSITIONS)) {
    throw new Error(`Unsupported order status: ${status}`);
  }

  return status as OrderStatus;
}

export async function updateOrderStatus(
  orderId: number,
  nextStatus: OrderStatus,
  env: RAGEnv,
  options: UpdateOrderStatusOptions = {}
): Promise<OrderRecord> {
  if (!(nextStatus in ORDER_STATUS_TRANSITIONS)) {
    throw new Error(`Unsupported order status: ${nextStatus}`);
  }

  const client = getAdminClient(env);
  const { data: existingOrder, error: lookupError } = await client
    .from('orders')
    .select('*')
    .eq('id', orderId)
    .maybeSingle();

  if (lookupError) {
    throw new Error(`Order lookup failed: ${lookupError.message}`);
  }

  if (!existingOrder) {
    throw new Error('Order not found');
  }

  const previousStatus = String(existingOrder.status);
  if (!validateStatusTransition(previousStatus, nextStatus)) {
    throw new Error(`Invalid order status transition: ${previousStatus} -> ${nextStatus}`);
  }

  if (previousStatus === nextStatus) {
    return existingOrder as OrderRecord;
  }

  const { data: updatedOrder, error: updateError } = await client
    .from('orders')
    .update({
      status: nextStatus,
      updated_at: new Date().toISOString(),
    })
    .eq('id', orderId)
    .eq('status', previousStatus)
    .select('*')
    .maybeSingle();

  if (updateError) {
    throw new Error(`Order status update failed: ${updateError.message}`);
  }

  if (!updatedOrder) {
    throw new Error('Order status update conflicted with another change');
  }

  const { error: historyError } = await client
    .from('order_status_history')
    .insert({
      order_id: orderId,
      previous_status: previousStatus,
      new_status: nextStatus,
      changed_by: options.changedBy ?? null,
      changed_by_role: options.changedByRole ?? 'admin',
      reason: options.reason ?? null,
      metadata: options.metadata ?? {},
    });

  if (historyError) {
    throw new Error(`Order status history insert failed: ${historyError.message}`);
  }

  const { error: notificationError } = await client
    .from('notification_events')
    .insert({
      order_id: orderId,
      customer_phone: String(existingOrder.customer_phone),
      event_type: 'order_status_changed',
      channel: 'whatsapp',
      status: 'queued',
      related_status: nextStatus,
      payload: {
        order_id: orderId,
        previous_status: previousStatus,
        new_status: nextStatus,
      },
      reason: options.reason ?? null,
    });

  if (notificationError) {
    throw new Error(`Notification event insert failed: ${notificationError.message}`);
  }

  return updatedOrder as OrderRecord;
}

export async function getOrderTimeline(
  orderId: number,
  env: RAGEnv
): Promise<OrderStatusHistoryRecord[]> {
  const client = getAdminClient(env);
  const { data, error } = await client
    .from('order_status_history')
    .select('*')
    .eq('order_id', orderId)
    .order('created_at', { ascending: true })
    .order('id', { ascending: true });

  if (error) {
    throw new Error(`Order timeline lookup failed: ${error.message}`);
  }

  return (data as OrderStatusHistoryRecord[]) ?? [];
}

const SUPPORT_TICKET_TRANSITIONS: Record<SupportTicketStatus, readonly SupportTicketStatus[]> = {
  OPEN: ['IN_PROGRESS', 'WAITING_CUSTOMER', 'WAITING_AGENT', 'RESOLVED', 'CLOSED'],
  IN_PROGRESS: ['WAITING_CUSTOMER', 'WAITING_AGENT', 'RESOLVED', 'CLOSED'],
  WAITING_CUSTOMER: ['IN_PROGRESS', 'WAITING_AGENT', 'RESOLVED', 'CLOSED'],
  WAITING_AGENT: ['IN_PROGRESS', 'RESOLVED', 'CLOSED'],
  RESOLVED: ['IN_PROGRESS', 'CLOSED'],
  CLOSED: [],
};

function isSupportTicketStatus(value: string): value is SupportTicketStatus {
  return SUPPORT_TICKET_STATUSES.includes(value as SupportTicketStatus);
}

function validateSupportTicketStatusTransition(
  currentStatus: SupportTicketStatus,
  nextStatus: SupportTicketStatus
): boolean {
  if (!isSupportTicketStatus(currentStatus) || !isSupportTicketStatus(nextStatus)) {
    return false;
  }

  return currentStatus === nextStatus || SUPPORT_TICKET_TRANSITIONS[currentStatus].includes(nextStatus);
}

function createTicketNumber(): string {
  return `TKT-${Date.now()}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
}

export async function createSupportTicket(
  input: CreateSupportTicketInput,
  env: RAGEnv
): Promise<SupportTicketRecord> {
  const customerPhone = input.customerPhone.trim();
  const issueType = input.issueType.trim();

  if (!customerPhone) {
    throw new Error('Customer phone is required');
  }

  if (!issueType) {
    throw new Error('Support ticket issue type is required');
  }

  const client = getAdminClient(env);
  const { data, error } = await client
    .from('support_tickets')
    .insert({
      ticket_number: input.ticketNumber?.trim() || createTicketNumber(),
      customer_id: input.customerId ?? null,
      customer_phone: customerPhone,
      order_id: input.orderId ?? null,
      issue_type: issueType,
      issue_description: input.issueDescription ?? null,
      product_name: input.productName ?? null,
      preferred_resolution: input.preferredResolution ?? null,
      priority: input.priority ?? 'NORMAL',
      status: 'OPEN',
    })
    .select('*')
    .single();

  if (error || !data) {
    throw new Error(`Support ticket creation failed: ${error?.message ?? 'Unknown error'}`);
  }

  return data as SupportTicketRecord;
}

export async function addSupportMessage(
  ticketId: number,
  senderType: SupportMessageSenderType,
  messageText: string,
  env: RAGEnv,
  senderId?: string | null
): Promise<SupportMessageRecord> {
  const trimmedMessage = messageText.trim();
  if (!trimmedMessage) {
    throw new Error('Support message is required');
  }

  const { data, error } = await getAdminClient(env)
    .from('support_messages')
    .insert({
      ticket_id: ticketId,
      sender_type: senderType,
      sender_id: senderId ?? null,
      message_text: trimmedMessage,
    })
    .select('*')
    .single();

  if (error || !data) {
    throw new Error(`Support message creation failed: ${error?.message ?? 'Unknown error'}`);
  }

  return data as SupportMessageRecord;
}

export async function getSupportMessages(
  ticketId: number,
  env: RAGEnv
): Promise<SupportMessageRecord[]> {
  const { data, error } = await getAdminClient(env)
    .from('support_messages')
    .select('*')
    .eq('ticket_id', ticketId)
    .order('created_at', { ascending: true })
    .order('id', { ascending: true });

  if (error) {
    throw new Error(`Support messages lookup failed: ${error.message}`);
  }

  return (data as SupportMessageRecord[]) ?? [];
}

export async function getSupportTicket(
  ticketId: number,
  env: RAGEnv
): Promise<SupportTicketRecord> {
  const client = getAdminClient(env);
  const { data, error } = await client
    .from('support_tickets')
    .select('*')
    .eq('id', ticketId)
    .maybeSingle();

  if (error) {
    throw new Error(`Support ticket lookup failed: ${error.message}`);
  }

  if (!data) {
    throw new Error('Support ticket not found');
  }

  return data as SupportTicketRecord;
}

export async function getSupportTicketByNumber(
  ticketNumber: string,
  env: RAGEnv
): Promise<SupportTicketRecord> {
  const normalizedTicketNumber = ticketNumber.trim();
  if (!normalizedTicketNumber) {
    throw new Error('Support ticket number is required');
  }

  const client = getAdminClient(env);
  const { data, error } = await client
    .from('support_tickets')
    .select('*')
    .eq('ticket_number', normalizedTicketNumber)
    .maybeSingle();

  if (error) {
    throw new Error(`Support ticket number lookup failed: ${error.message}`);
  }

  if (!data) {
    throw new Error('Support ticket not found');
  }

  return data as SupportTicketRecord;
}

export async function getCustomerTickets(
  customerPhone: string,
  env: RAGEnv
): Promise<SupportTicketRecord[]> {
  const normalizedPhone = customerPhone.trim();
  if (!normalizedPhone) {
    return [];
  }

  const client = getAdminClient(env);
  const { data, error } = await client
    .from('support_tickets')
    .select('*')
    .eq('customer_phone', normalizedPhone)
    .order('created_at', { ascending: false });

  if (error) {
    throw new Error(`Customer support ticket lookup failed: ${error.message}`);
  }

  return (data as SupportTicketRecord[]) ?? [];
}

export async function getLatestCustomerSupportTicket(
  phoneNumber: string,
  env: RAGEnv
): Promise<SupportTicketRecord | null> {
  const tickets = await getCustomerTickets(phoneNumber, env);
  const activeStatuses: readonly SupportTicketStatus[] = [
    'OPEN',
    'IN_PROGRESS',
    'WAITING_CUSTOMER',
    'WAITING_AGENT',
  ];
  const latestTicket = tickets.find((ticket) => activeStatuses.includes(ticket.status));

  console.log('[SUPPORT TICKET LOOKUP] Latest active ticket result', {
    phoneNumber,
    ticketId: latestTicket?.id ?? null,
    ticketNumber: latestTicket?.ticket_number ?? null,
    status: latestTicket?.status ?? null,
  });

  return latestTicket ?? null;
}

export async function getLatestOpenCustomerSupportTicket(
  phoneNumber: string,
  env: RAGEnv
): Promise<SupportTicketRecord | null> {
  const { data, error } = await getAdminClient(env)
    .from('support_tickets')
    .select('*')
    .eq('customer_phone', phoneNumber.trim())
    .eq('status', 'OPEN')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(`Open support ticket lookup failed: ${error.message}`);
  }

  return (data as SupportTicketRecord | null) ?? null;
}

export async function createSupportAgentSession(
  ticketId: number,
  customerPhone: string,
  env: RAGEnv
): Promise<SupportAgentSessionRecord> {
  const { data, error } = await getAdminClient(env)
    .from('support_agent_sessions')
    .insert({
      ticket_id: ticketId,
      customer_phone: customerPhone.trim(),
      agent_id: null,
      status: 'WAITING_FOR_AGENT',
    })
    .select('*')
    .single();

  if (error || !data) {
    throw new Error(`Support agent session creation failed: ${error?.message ?? 'Unknown error'}`);
  }

  return data as SupportAgentSessionRecord;
}

export async function getWaitingAgentSessions(env: RAGEnv): Promise<SupportAgentSessionRecord[]> {
  const { data, error } = await getAdminClient(env)
    .from('support_agent_sessions')
    .select('*')
    .eq('status', 'WAITING_FOR_AGENT')
    .order('id', { ascending: true });

  if (error) {
    throw new Error(`Waiting agent sessions lookup failed: ${error.message}`);
  }

  return (data as SupportAgentSessionRecord[]) ?? [];
}

export async function getSupportAgentSession(
  sessionId: number,
  env: RAGEnv
): Promise<SupportAgentSessionRecord | null> {
  const { data, error } = await getAdminClient(env)
    .from('support_agent_sessions')
    .select('*')
    .eq('id', sessionId)
    .maybeSingle();

  if (error) {
    throw new Error(`Support agent session lookup failed: ${error.message}`);
  }

  return (data as SupportAgentSessionRecord | null) ?? null;
}

export async function getActiveOrWaitingAgentSessionForTicket(
  ticketId: number,
  env: RAGEnv
): Promise<SupportAgentSessionRecord | null> {
  const { data, error } = await getAdminClient(env)
    .from('support_agent_sessions')
    .select('*')
    .eq('ticket_id', ticketId)
    .in('status', ['WAITING_FOR_AGENT', 'ACTIVE'])
    .order('id', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(`Agent session lookup for ticket failed: ${error.message}`);
  }

  return (data as SupportAgentSessionRecord | null) ?? null;
}

// Atomic: only succeeds if the session was still WAITING_FOR_AGENT at update time,
// so two agents racing to accept the same session can never both win.
export async function acceptSupportAgentSession(
  sessionId: number,
  agentId: string,
  env: RAGEnv
): Promise<SupportAgentSessionRecord | null> {
  const { data, error } = await getAdminClient(env)
    .from('support_agent_sessions')
    .update({ status: 'ACTIVE', agent_id: agentId.trim() })
    .eq('id', sessionId)
    .eq('status', 'WAITING_FOR_AGENT')
    .select('*')
    .maybeSingle();

  if (error) {
    throw new Error(`Support agent session accept failed: ${error.message}`);
  }

  return (data as SupportAgentSessionRecord | null) ?? null;
}

export async function closeSupportAgentSession(
  sessionId: number,
  env: RAGEnv
): Promise<SupportAgentSessionRecord | null> {
  const { data, error } = await getAdminClient(env)
    .from('support_agent_sessions')
    .update({ status: 'CLOSED' })
    .eq('id', sessionId)
    .neq('status', 'CLOSED')
    .select('*')
    .maybeSingle();

  if (error) {
    throw new Error(`Support agent session close failed: ${error.message}`);
  }

  return (data as SupportAgentSessionRecord | null) ?? null;
}

export async function updateSupportTicketStatus(
  ticketId: number,
  nextStatus: SupportTicketStatus,
  env: RAGEnv
): Promise<SupportTicketRecord> {
  if (!isSupportTicketStatus(nextStatus)) {
    throw new Error(`Unsupported support ticket status: ${String(nextStatus)}`);
  }

  const ticket = await getSupportTicket(ticketId, env);
  if (!validateSupportTicketStatusTransition(ticket.status, nextStatus)) {
    throw new Error(`Invalid support ticket status transition: ${ticket.status} -> ${nextStatus}`);
  }

  if (ticket.status === nextStatus) {
    return ticket;
  }

  console.log('[SUPPORT TICKET STATUS] Updating ticket status', {
    ticketId,
    ticketNumber: ticket.ticket_number,
    previousStatus: ticket.status,
    nextStatus,
  });

  const resolvedAt = nextStatus === 'RESOLVED' || nextStatus === 'CLOSED'
    ? ticket.resolved_at ?? new Date().toISOString()
    : null;

  const client = getAdminClient(env);
  const { data, error } = await client
    .from('support_tickets')
    .update({
      status: nextStatus,
      resolved_at: resolvedAt,
      updated_at: new Date().toISOString(),
    })
    .eq('id', ticketId)
    .eq('status', ticket.status)
    .select('*')
    .maybeSingle();

  if (error) {
    throw new Error(`Support ticket status update failed: ${error.message}`);
  }

  if (!data) {
    throw new Error('Support ticket status update conflicted with another change');
  }

  console.log('[SUPPORT TICKET STATUS] Ticket status updated', {
    ticketId,
    ticketNumber: data.ticket_number,
    previousStatus: ticket.status,
    nextStatus: data.status,
    resolvedAt: data.resolved_at,
  });

  return data as SupportTicketRecord;
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

export async function generateAnswer(
  question: string,
  env: RAGEnv,
  whatsappNumber?: string,
  state: ConversationState = 'MAIN_MENU'
): Promise<string> {
  const docs = await retrieveKnowledgeContext(question, env);
  const answer = await generateAnswerFromContext(question, docs, env);

  if (whatsappNumber) {
    await logInteraction(whatsappNumber, question, docs, { selected_documents: docs.slice(0, 3) }, answer, state, env);
  }

  return answer;
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

// Optimistic-concurrency decrement: reads current stock, then updates only if
// it still matches what was just read (`.eq('stock', currentStock)`), retrying
// on conflict. This is the same conditional-update pattern already used by
// acceptSupportAgentSession/closeSupportAgentSession elsewhere in this file —
// it uses only the existing `products.stock` column (no new schema), and is
// genuinely safe under concurrent decrements, unlike a plain read-then-write.
export async function decrementProductStock(
  productId: number,
  quantity: number,
  env: RAGEnv
): Promise<void> {
  if (quantity <= 0) {
    return;
  }

  const client = getAdminClient(env);

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const { data: product, error: fetchError } = await client
      .from('products')
      .select('id, stock')
      .eq('id', productId)
      .maybeSingle();

    if (fetchError) {
      throw new Error(`Product stock lookup failed: ${fetchError.message}`);
    }

    if (!product) {
      console.warn('[INVENTORY DECREMENT] Product not found, skipping', { productId });
      return;
    }

    const currentStock = Number(product.stock);
    const nextStock = Math.max(0, currentStock - quantity);

    const { data: updated, error: updateError } = await client
      .from('products')
      .update({ stock: nextStock })
      .eq('id', productId)
      .eq('stock', currentStock)
      .select('id')
      .maybeSingle();

    if (updateError) {
      throw new Error(`Product stock update failed: ${updateError.message}`);
    }

    if (updated) {
      console.log('[INVENTORY DECREMENT]', {
        productId,
        quantity,
        previousStock: currentStock,
        newStock: nextStock,
      });
      return;
    }

    // Someone else updated stock between our read and write; retry with a fresh read.
  }

  throw new Error(`Could not update stock for product ${productId} after retries (concurrent update contention)`);
}

export async function handleRazorpaySuccessWebhook(
  rawBody: string,
  signature: string,
  env: CommerceEnv
): Promise<{ ok: boolean; orderId?: number; customerPhone?: string; totalAmount?: number }> {
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

  // Logged unconditionally, before the event-type filter below, so we can see
  // exactly what Razorpay is actually sending regardless of whether it matches.
  console.log('[RAZORPAY WEBHOOK] event.event:', event.event);
  console.log('[RAZORPAY WEBHOOK] payment_link_id:', event.payload?.payment_link?.entity?.id);
  console.log('[RAZORPAY WEBHOOK] payment_id:', event.payload?.payment?.entity?.id);

  if (event.event !== 'payment_link.paid') {
    console.log('[RAZORPAY WEBHOOK] event ignored (does not match payment_link.paid):', event.event);
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

  console.log('[RAZORPAY WEBHOOK] order lookup result:', {
    linkId,
    found: Boolean(order),
    orderId: order?.id ?? null,
    currentStatus: order?.status ?? null,
    error: error?.message ?? null,
  });

  if (error) {
    throw new Error(`Order lookup for payment failed: ${error.message}`);
  }

  if (!order) {
    throw new Error('Order not found for payment link');
  }

  // Idempotency guard: Razorpay may redeliver the same payment_link.paid
  // event. orders.status is the existing signal for "already processed" —
  // no new column/table needed. The .eq('status', order.status) below also
  // closes the race window for two near-simultaneous deliveries: only the
  // request that actually flips the row proceeds to decrement inventory.
  if (order.status === 'paid') {
    console.log('[RAZORPAY WEBHOOK] Duplicate payment_link.paid ignored (order already paid)', {
      orderId: order.id,
    });
    return {
      ok: true,
      orderId: Number(order.id),
      customerPhone: order.customer_phone,
      totalAmount: Number(order.total_amount),
    };
  }

  const paymentEntity = event.payload?.payment?.entity ?? {};
  const { data: updatedOrder, error: updateError } = await client
    .from('orders')
    .update({
      status: 'paid',
      razorpay_payment_id: paymentEntity.id ?? null,
      paid_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', order.id)
    .eq('status', order.status)
    .select('id')
    .maybeSingle();

  console.log('[RAZORPAY WEBHOOK] order update result:', {
    orderId: order.id,
    success: !updateError && Boolean(updatedOrder),
    error: updateError?.message ?? null,
  });

  if (updateError) {
    throw new Error(`Order payment completion failed: ${updateError.message}`);
  }

  if (updatedOrder) {
    const { data: orderItems, error: itemsError } = await client
      .from('order_items')
      .select('product_id, quantity')
      .eq('order_id', order.id);

    if (itemsError) {
      throw new Error(`Order items lookup for inventory decrement failed: ${itemsError.message}`);
    }

    for (const item of orderItems ?? []) {
      if (item.product_id) {
        await decrementProductStock(Number(item.product_id), Number(item.quantity), env);
      }
    }
  } else {
    console.log('[RAZORPAY WEBHOOK] Order status changed concurrently; skipping duplicate inventory decrement', {
      orderId: order.id,
    });
  }

  return {
    ok: true,
    orderId: Number(order.id),
    customerPhone: order.customer_phone,
    totalAmount: Number(order.total_amount),
  };
}
