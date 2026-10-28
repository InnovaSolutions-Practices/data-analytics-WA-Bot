import {
  getInventory,
  getInvoice,
  getLatestOrder,
  getOrderHistory,
  getPaymentInfo,
  getProductDetails,
  type CommerceToolResult,
} from './commerce-tools';
import {
  getCommerceContext,
  resolveProductName,
  resolveCommerceReferences,
  saveCommerceContext,
  updateCustomerProfile,
} from './commerce-memory';
import type { RAGEnv } from './rag';

export type CommerceIntent =
  | 'ORDER_STATUS'
  | 'ORDER_HISTORY'
  | 'PRODUCT_QUERY'
  | 'INVENTORY_QUERY'
  | 'PAYMENT_QUERY'
  | 'INVOICE_QUERY'
  | 'DELIVERY_QUERY'
  | 'CANCEL_ORDER_QUERY'
  | 'RETURN_QUERY'
  | 'REFUND_QUERY'
  | 'UNKNOWN';

export interface CommerceIntentRequest {
  intent: CommerceIntent;
  orderId: number | null;
  productName: string | null;
}

export interface CommerceIntentClassification {
  intents: CommerceIntentRequest[];
}

const ORDER_RELATED_INTENTS: ReadonlySet<CommerceIntent> = new Set([
  'ORDER_STATUS',
  'ORDER_HISTORY',
  'PAYMENT_QUERY',
  'INVOICE_QUERY',
  'DELIVERY_QUERY',
  'CANCEL_ORDER_QUERY',
  'RETURN_QUERY',
  'REFUND_QUERY',
]);

export interface CommerceToolExecution {
  intent: CommerceIntentRequest;
  toolName: string;
  facts: unknown;
  found: boolean;
  message?: string;
}

export interface CommerceRouteResult {
  classification: CommerceIntentClassification;
  executions: CommerceToolExecution[];
  facts: Record<string, unknown>;
  messages: string[];
}

function normalizeIntent(value: unknown): CommerceIntent {
  const intent = String(value ?? '').trim().toUpperCase();
  const supported: CommerceIntent[] = [
    'ORDER_STATUS',
    'ORDER_HISTORY',
    'PRODUCT_QUERY',
    'INVENTORY_QUERY',
    'PAYMENT_QUERY',
    'INVOICE_QUERY',
    'DELIVERY_QUERY',
    'CANCEL_ORDER_QUERY',
    'RETURN_QUERY',
    'REFUND_QUERY',
  ];
  return supported.includes(intent as CommerceIntent)
    ? intent as CommerceIntent
    : 'UNKNOWN';
}

function extractOrderId(message: string, value: unknown): number | null {
  const parsed = Number(value);
  if (Number.isInteger(parsed) && parsed > 0) {
    return parsed;
  }

  const match = message.match(/\border\s*#?\s*(\d+)\b|\b#(\d+)\b/i);
  const extracted = Number(match?.[1] ?? match?.[2]);
  return Number.isInteger(extracted) && extracted > 0 ? extracted : null;
}

async function callOpenAIClassifier(
  message: string,
  env: RAGEnv
): Promise<CommerceIntentClassification> {
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: env.OPENAI_CHAT_MODEL || 'gpt-4o-mini',
      temperature: 0,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: [
            'You classify commerce questions for a WhatsApp store assistant.',
            'Return only valid JSON with exactly this shape: {"intents":[{"intent":"ORDER_STATUS","orderId":null,"productName":null}]}',
            'Return one entry for every supported request in the customer message.',
            'Each intent must be one of ORDER_STATUS, ORDER_HISTORY, PRODUCT_QUERY, INVENTORY_QUERY, PAYMENT_QUERY, INVOICE_QUERY, DELIVERY_QUERY, CANCEL_ORDER_QUERY, RETURN_QUERY, REFUND_QUERY, UNKNOWN.',
            'orderId must be a positive integer when explicitly present for that intent, otherwise null.',
            'productName must be the requested product name for that intent when present, otherwise null.',
            'Do not answer the customer and do not invent values.',
          ].join(' '),
        },
        { role: 'user', content: message },
      ],
    }),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`AI commerce intent classification failed (${response.status}): ${errorBody}`);
  }

  const payload = await response.json() as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  let parsed: { intents?: unknown } = {};
  try {
    parsed = JSON.parse(payload.choices?.[0]?.message?.content ?? '{}') as typeof parsed;
  } catch {
    parsed = {};
  }

  const rawIntents = Array.isArray(parsed.intents) ? parsed.intents : [];
  const intents = rawIntents.map((entry) => {
    const value = entry as { intent?: unknown; orderId?: unknown; productName?: unknown };
    return {
      intent: normalizeIntent(value.intent),
      orderId: extractOrderId(message, value.orderId),
      productName: typeof value.productName === 'string' && value.productName.trim()
        ? value.productName.trim()
        : null,
    };
  });

  return { intents: intents.length > 0 ? intents : [{ intent: 'UNKNOWN', orderId: null, productName: null }] };
}

export async function classifyCommerceIntent(
  message: string,
  env: RAGEnv
): Promise<CommerceIntentClassification> {
  const classification = await callOpenAIClassifier(message, env);
  console.log('[AI COMMERCE INTENTS]', {
    message,
    intents: classification.intents,
  });
  return classification;
}

function unwrapToolResult(result: CommerceToolResult): { facts: unknown; message?: string } {
  return { facts: result.data, message: result.message };
}

async function executeCommerceTool(
  phoneNumber: string,
  intent: CommerceIntentRequest,
  env: RAGEnv
): Promise<CommerceToolExecution | null> {
  let toolName: string;
  let result: CommerceToolResult;

  switch (intent.intent) {
    case 'ORDER_STATUS':
      toolName = 'getLatestOrder';
      result = await getLatestOrder(phoneNumber, env);
      break;
    case 'ORDER_HISTORY':
      toolName = 'getOrderHistory';
      result = await getOrderHistory(phoneNumber, env);
      break;
    case 'PRODUCT_QUERY':
      toolName = 'getProductDetails';
      result = await getProductDetails(intent.productName ?? '', env);
      break;
    case 'INVENTORY_QUERY':
      toolName = 'getInventory';
      result = await getInventory(intent.productName ?? '', env);
      break;
    case 'PAYMENT_QUERY':
      toolName = 'getPaymentInfo';
      result = intent.orderId
        ? await getPaymentInfo(intent.orderId, env)
        : { found: false, data: null, message: 'Please provide an order number for payment information.' };
      break;
    case 'INVOICE_QUERY':
      toolName = 'getInvoice';
      result = intent.orderId
        ? await getInvoice(intent.orderId, env)
        : { found: false, data: null, message: 'Please provide an order number for invoice information.' };
      break;
    case 'DELIVERY_QUERY':
      toolName = 'getLatestOrder';
      result = await getLatestOrder(phoneNumber, env);
      break;
    case 'CANCEL_ORDER_QUERY':
      toolName = 'getLatestOrder';
      result = await getLatestOrder(phoneNumber, env);
      break;
    case 'RETURN_QUERY':
      toolName = 'getLatestOrder';
      result = await getLatestOrder(phoneNumber, env);
      break;
    case 'REFUND_QUERY':
      toolName = 'getLatestOrder';
      result = await getLatestOrder(phoneNumber, env);
      break;
    default:
      return null;
  }

  const unwrapped = unwrapToolResult(result);
  if (intent.intent === 'DELIVERY_QUERY') {
    console.log('[DELIVERY QUERY]', { orderId: intent.orderId, found: result.found });
  }
  if (intent.intent === 'CANCEL_ORDER_QUERY') {
    console.log('[CANCEL ORDER QUERY]', { orderId: intent.orderId, found: result.found });
  }

  const facts = ['DELIVERY_QUERY', 'CANCEL_ORDER_QUERY', 'RETURN_QUERY', 'REFUND_QUERY'].includes(intent.intent)
    ? {
      ...(unwrapped.facts as Record<string, unknown> | null ?? {}),
      commerce_rule: getOrderActionRule(intent.intent, unwrapped.facts),
    }
    : unwrapped.facts;
  return {
    intent,
    found: result.found,
    toolName,
    facts,
    message: unwrapped.message,
  };
}

function getOrderActionRule(intent: CommerceIntent, facts: unknown): string {
  const status = facts && typeof facts === 'object' && 'status' in facts
    ? String((facts as { status?: unknown }).status)
    : 'unknown';

  switch (intent) {
    case 'DELIVERY_QUERY':
      return `Explain delivery using only the verified order status (${status}). Do not promise a date unless a verified date exists.`;
    case 'CANCEL_ORDER_QUERY':
      return ['pending', 'payment_pending'].includes(status)
        ? `The verified order status is ${status}; explain that cancellation can be requested while it is pending.`
        : `The verified order status is ${status}; do not claim cancellation is available. Explain that support assistance is required.`;
    case 'RETURN_QUERY':
      return `Answer using the verified order status (${status}) and do not invent a return policy. State that support can review the request if no verified policy record is available.`;
    case 'REFUND_QUERY':
      return `Answer using the verified order status (${status}) and payment facts only. Do not promise a refund or invent a refund policy.`;
    default:
      return '';
  }
}

export async function retrieveCommerceFacts(
  phoneNumber: string,
  classification: CommerceIntentClassification,
  env: RAGEnv
): Promise<CommerceRouteResult> {
  const executions = (await Promise.all(
    classification.intents.map((intent) => executeCommerceTool(phoneNumber, intent, env))
  )).filter((execution): execution is CommerceToolExecution => execution !== null);

  const facts = Object.fromEntries(
    executions.map((execution, index) => [
      `${execution.intent.intent}_${index + 1}`,
      execution.facts,
    ])
  );
  const messages = executions
    .map((execution) => execution.message)
    .filter((message): message is string => Boolean(message));

  console.log('[AI COMMERCE TOOLS EXECUTED]', {
    tools: executions.map((execution) => execution.toolName),
    intents: executions.map((execution) => execution.intent.intent),
  });

  return { classification, executions, facts, messages };
}

export async function generateCommerceResponse(
  message: string,
  route: CommerceRouteResult,
  env: RAGEnv
): Promise<string> {
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: env.OPENAI_CHAT_MODEL || 'gpt-4o-mini',
      temperature: 0.2,
      max_tokens: 220,
      messages: [
        {
          role: 'system',
          content: 'You format factual commerce data for a customer. Use only the supplied database facts and commerce_rule instructions. Never invent or infer order, product, stock, payment, delivery date, cancellation availability, return policy, refund policy, or invoice information. If facts are empty, state that no verified record was found. Keep the response concise.',
        },
        {
          role: 'user',
          content: JSON.stringify({
            question: message,
            intents: route.classification.intents,
            verified_facts: route.facts,
            tool_messages: route.messages,
          }),
        },
      ],
    }),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`AI commerce response generation failed (${response.status}): ${errorBody}`);
  }

  const payload = await response.json() as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const answer = payload.choices?.[0]?.message?.content?.trim();
  if (!answer) {
    throw new Error('AI commerce response was empty');
  }

  console.log('[AI COMMERCE AGGREGATED RESPONSE]', {
    intents: route.classification.intents.map((intent) => intent.intent),
    tools: route.executions.map((execution) => execution.toolName),
  });
  return answer;
}

export async function answerCommerceQuestion(
  phoneNumber: string,
  message: string,
  env: RAGEnv
): Promise<string | null> {
  const classification = await classifyCommerceIntent(message, env);
  const supportedIntents = classification.intents.filter((intent) => intent.intent !== 'UNKNOWN');
  if (supportedIntents.length === 0) {
    return null;
  }

  const context = await getCommerceContext(phoneNumber, env);
  const resolvedIntents = await Promise.all(supportedIntents.map(async (intent) => {
    const references = resolveCommerceReferences(context, intent);
    let productName = references.productName;
    if (['PRODUCT_QUERY', 'INVENTORY_QUERY'].includes(intent.intent) && productName) {
      productName = await resolveProductName(productName, env) ?? productName;
    }
    return {
      ...intent,
      orderId: references.orderId,
      productName,
    };
  }));

  const route = await retrieveCommerceFacts(phoneNumber, { intents: resolvedIntents }, env);
  try {
    await saveSuccessfulCommerceMemory(phoneNumber, route, env);
  } catch (error) {
    console.error('[CUSTOMER PROFILE ENRICHMENT SKIPPED]', {
      phoneNumber,
      reason: error instanceof Error ? error.message : String(error),
    });
  }
  return generateCommerceResponse(message, route, env);
}

function getOrderIdFromFacts(facts: unknown): number | null {
  // ORDER_HISTORY's facts are an array of orders (most-recent-first, per
  // getOrderHistory's own ordering) rather than a single order object.
  const first = Array.isArray(facts) ? facts[0] : facts;
  if (!first || typeof first !== 'object') return null;
  const value = first as { id?: unknown; order_id?: unknown };
  const id = Number(value.id ?? value.order_id);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function getProductFromFacts(facts: unknown): string | null {
  if (!facts || typeof facts !== 'object') return null;
  const value = facts as { name?: unknown; product_name?: unknown; order_items?: Array<{ product_name?: unknown }> };
  const directName = value.name ?? value.product_name ?? value.order_items?.[0]?.product_name;
  return typeof directName === 'string' && directName.trim() ? directName.trim() : null;
}

async function saveSuccessfulCommerceMemory(
  phoneNumber: string,
  route: CommerceRouteResult,
  env: RAGEnv
): Promise<void> {
  for (const execution of route.executions.filter((execution) => execution.found)) {
    const facts = execution.facts;
    // getOrderIdFromFacts() reads a bare `.id`/`.order_id` off whatever facts
    // this execution produced. For non-order intents (PRODUCT_QUERY,
    // INVENTORY_QUERY) that object is a *product* record, so its `.id` is a
    // product ID, not an order ID — saving it as last_order_id silently
    // corrupts the customer's order context (e.g. Shoes' product id ending
    // up as last_order_id). Only ever derive/persist an order ID for
    // genuinely order-related intents.
    //
    // Within those intents, prefer the ID actually present in the
    // freshly-fetched result over execution.intent.orderId: when no order
    // number is explicit in the message, intent.orderId is only
    // resolveCommerceReferences() falling back to the *previous* saved
    // last_order_id. Trusting that value here would make a once-stale
    // last_order_id persist forever instead of self-correcting from the
    // real order the tool just fetched.
    const orderId = ORDER_RELATED_INTENTS.has(execution.intent.intent)
      ? getOrderIdFromFacts(facts) ?? execution.intent.orderId
      : null;
    const product = execution.intent.productName ?? getProductFromFacts(facts);
    await saveCommerceContext(
      phoneNumber,
      {
        last_product: product,
        last_order_id: orderId,
        last_intent: execution.intent.intent,
      },
      env
    );
  }

  if (route.executions.some((execution) => execution.found)) {
    await updateCustomerProfile(phoneNumber, env);
  }
}