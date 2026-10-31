// <<<<<<< HEAD
// // Hey bot
// =======
// // HEY chatbot
// >>>>>>> main
import {
	createClient,
	SupabaseClient,
} from "@supabase/supabase-js";
import {
	acceptSupportAgentSession,
	addItemToCart,
	addSupportMessage,
	attachSupportSessionMedia,
	clearCart as clearCommerceCart,
	closeSupportAgentSession,
	createSupportSession,
	createSupportAgentSession,
	createTicketFromSupportSession,
	createOrderFromCart,
	createRazorpayPaymentLink as createCommercePaymentLink,
	createSupportTicket,
	ensurePendingOrderDelivery,
	getConversationState,
	getCustomerDeliveryAddresses,
	getOrderDeliveryDetails,
	getActiveOrWaitingAgentSessionForTicket,
	getActiveSupportSession,
	getOrderStatus,
	getOrderTimeline,
	getWaitingAgentSessions,
	isAffirmativeAnswer,
	getLatestCustomerSupportTicket,
	getLatestOpenCustomerSupportTicket,
	getLatestTicketCreatedSupportSession,
	getSupportAgentSession,
	getSupportMessages,
	isNegativeAnswer,
	getSupportTicket,
	handleRazorpaySuccessWebhook,
	linkSavedDeliveryAddressToOrder,
	saveDeliveryAddressForCustomer,
	setOrderDeliveryResponse,
	normalizeSupportSessionAnswer,
	SUPPORT_TICKET_STATUSES,
	updateSupportSession,
	updateOrderStatus,
	updateOrderDeliveryStatus,
	updateSupportTicketStatus,
	updateOrderPaymentLink,
	upsertConversationState,
	upsertCustomer,
	viewCart,
	type OrderStatus,
	type DeliveryAddressRecord,
	type SupportAgentSessionRecord,
	type DeliveryAddressInput,
	type DeliveryStatus,
	type SupportTicketRecord,
	type SupportTicketStatus,
} from "./commerce";
import { generateAnswer, generateAnswerFromContext, generateRAGResponse, retrieveKnowledgeContext } from "./rag";
import { answerCommerceQuestion } from "./ai-commerce-router";
import {
	buildDeliveryAddressFlowMessage,
	parseDeliveryAddressFlowSubmission,
} from "./whatsapp-flows";

interface Env {
	AI: Ai;
	SUPABASE_URL: string;
	SUPABASE_ANON_KEY: string;
	SUPABASE_SERVICE_ROLE_KEY: string;

	WHATSAPP_TOKEN: string;
	PHONE_NUMBER_ID: string;
	WHATSAPP_APP_SECRET?: string;
	WHATSAPP_DELIVERY_FLOW_ID?: string;

	RAZORPAY_KEY_ID: string;
	RAZORPAY_KEY_SECRET: string;
	RAZORPAY_WEBHOOK_SECRET: string;

	OPENAI_API_KEY: string;
	OPENAI_CHAT_MODEL?: string;
	RAG_MATCH_THRESHOLD?: string;
	ADMIN_API_TOKEN?: string;

	// International-format human support number (digits only or with
	// separators/+ — normalized by normalizeWhatsAppNumber) used to build the
	// direct WhatsApp handoff link for the customer-facing "Connect to Agent"
	// CTA. Not a secret, but kept out of source control like the rest of
	// this Env — see .dev.vars.example.
	SUPPORT_WHATSAPP_NUMBER?: string;
}

interface Product {
	id: number;
	name: string;
	price: number;
	description: string | null;
	stock: number;
}

interface Order {
	id: number;
	customer_id?: number | null;
	customer_phone: string;
	product_id: number;
	product_name: string;
	quantity: number;
	unit_price: number;
	total_amount: number;
	status: string;
	razorpay_payment_link_id: string | null;
	razorpay_payment_link_url: string | null;
	razorpay_payment_id: string | null;
	created_at: string;
	updated_at: string;
	paid_at: string | null;
	order_items?: Array<{ product_name: string; quantity: number }>;
}

interface Cart {
	id: number;
	customer_phone: string;
	status: string;
	created_at: string;
	updated_at: string;
}

interface CartItem {
	id: number;
	cart_id: number;
	product_id: number;
	product_name: string;
	unit_price: number;
	quantity: number;
}

interface RazorpayPaymentLink {
	id: string;
	short_url: string;
}
interface AITextResponse {
	response?: string;
}
interface ExistingOrder {
	id: number;
	razorpay_payment_link_url: string | null;
}

interface ExistingCartItem {
	id: number;
	quantity: number;
}
interface AITextResponse {

    response?: string;

}

const VERIFY_TOKEN = "whatsapp-bot-secret-123";

interface AdminOrderStatusRequest {
	status?: string;
	reason?: string;
	changed_by?: string;
	changed_by_role?: string;
}

interface AdminOrderDeliveryStatusRequest {
	status?: string;
}

interface AdminTicketStatusRequest {
	status?: string;
}

interface AdminTicketReplyRequest {
	message?: string;
}

interface AgentAcceptRequest {
	agentId?: string;
}

interface AgentReplyRequest {
	agentId?: string;
	message?: string;
}

interface AgentEndRequest {
	agentId?: string;
}

/*
|--------------------------------------------------------------------------
| Supabase clients - test msg
|--------------------------------------------------------------------------
*/

function getAdminClient(env: Env): SupabaseClient {
	const supabaseUrl = env.SUPABASE_URL?.trim();
	const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY?.trim();

	console.log({
		hasUrl: Boolean(supabaseUrl),
		hasServiceKey: Boolean(serviceRoleKey),
	});

	if (!supabaseUrl || !serviceRoleKey) {
		throw new Error(
			"Supabase admin client configuration is missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY."
		);
	}

	try {
		new URL(supabaseUrl);
	} catch {
		throw new Error("SUPABASE_URL must be a valid absolute URL.");
	}

	return createClient(
		supabaseUrl,
		serviceRoleKey,
		{
			auth: {
				persistSession: false,
				autoRefreshToken: false,
			},
		}
	);
}

function getPublicClient(env: Env): SupabaseClient {
	return createClient(
		env.SUPABASE_URL,
		env.SUPABASE_ANON_KEY,
		{
			auth: {
				persistSession: false,
				autoRefreshToken: false,
			},
		}
	);
}

/*
|--------------------------------------------------------------------------
| WhatsApp API helpers
|--------------------------------------------------------------------------
*/

interface WhatsAppSendResult {
	endpoint: string;
	httpStatus: number;
	responseBody: unknown;
	metaMessageId: string | null;
}

function maskPhoneNumber(phoneNumber: string): string {
	const digits = phoneNumber.replace(/\D/g, "");
	return digits.length > 4
		? `${"*".repeat(digits.length - 4)}${digits.slice(-4)}`
		: "****";
}

function sanitizeWhatsAppLogValue(value: unknown, key = ""): unknown {
	if (typeof value === "string") {
		if (["to", "input", "wa_id", "recipient_id"].includes(key)) {
			return maskPhoneNumber(value);
		}
		return value
			.replace(/(Hi )[^,\n]+(, )/g, "$1<customer>$2")
			.replace(/(?<!\d)\+?\d[\d\s().-]{6,}\d(?!\d)/g, (phone) =>
				maskPhoneNumber(phone)
			);
	}
	if (Array.isArray(value)) {
		return value.map((item) => sanitizeWhatsAppLogValue(item));
	}
	if (value && typeof value === "object") {
		return Object.fromEntries(
			Object.entries(value).map(([entryKey, entryValue]) => [
				entryKey,
				sanitizeWhatsAppLogValue(entryValue, entryKey),
			])
		);
	}
	return value;
}

async function recordWhatsAppDeliveryStatuses(body: any, env: Env): Promise<void> {
	const statuses = (body.entry ?? [])
		.flatMap((entry: any) => entry.changes ?? [])
		.flatMap((change: any) => change.value?.statuses ?? []);
	const client = getAdminClient(env);

	for (const delivery of statuses) {
		const metaMessageId = String(delivery.id ?? "");
		const deliveryStatus = String(delivery.status ?? "unknown");
		const recipient = String(delivery.recipient_id ?? "");
		const timestamp = delivery.timestamp ? String(delivery.timestamp) : null;
		const errors = delivery.errors
			? sanitizeWhatsAppLogValue(delivery.errors)
			: null;

		console.log("[WHATSAPP_DELIVERY_STATUS]", {
			metaMessageId: metaMessageId || null,
			status: deliveryStatus,
			recipient: maskPhoneNumber(recipient),
			timestamp,
			errors,
		});

		if (!metaMessageId) continue;
		if (!["sent", "delivered", "read", "failed"].includes(deliveryStatus)) {
			continue;
		}

		try {
			const { data: event, error: lookupError } = await client
				.from("notification_events")
				.select("id, payload, status")
				.contains("payload", { meta_message_id: metaMessageId })
				.maybeSingle();
			if (lookupError) throw new Error(lookupError.message);
			if (!event) {
				console.log("[WHATSAPP_DELIVERY_STATUS]", {
					metaMessageId,
					status: deliveryStatus,
					eventMatched: false,
				});
				continue;
			}

			const existingPayload =
					(event.payload as Record<string, unknown> | null) ?? {};
			const deliveryRank: Record<string, number> = {
					sent: 1,
					delivered: 2,
					read: 3,
					failed: 4,
			};
			const existingDeliveryStatus = String(
					existingPayload.delivery_status ?? ""
			);
			const effectiveStatus =
					(deliveryRank[existingDeliveryStatus] ?? 0) >
					(deliveryRank[deliveryStatus] ?? 0)
						? existingDeliveryStatus
						: deliveryStatus;
			const eventStatus =
					effectiveStatus === "delivered" || effectiveStatus === "read"
						? "delivered"
						: effectiveStatus === "sent"
							? event.status === "queued" ? "sent" : event.status
							: effectiveStatus === "failed"
								? "failed"
								: event.status;
			/* Status values are monotonic: late "sent" callbacks cannot undo a
			 * delivered/read result. */
			const nextPayload = {
					...existingPayload,
					delivery_status: effectiveStatus,
					delivery_status_timestamp:
						effectiveStatus === deliveryStatus ? timestamp : existingPayload.delivery_status_timestamp,
					delivery_errors:
						effectiveStatus === "failed" ? errors : existingPayload.delivery_errors ?? null,
			};
			const { error: updateError } = await client
					.from("notification_events")
					.update({
						status: eventStatus,
						payload: nextPayload,
						...(effectiveStatus === "failed"
							? { reason: JSON.stringify(errors ?? "WhatsApp message failed") }
							: {}),
					})
					.eq("id", event.id);
			if (updateError) throw new Error(updateError.message);
			console.log("[WHATSAPP_DELIVERY_STATUS]", {
					metaMessageId,
					status: deliveryStatus,
					eventMatched: true,
					eventUpdated: true,
			});
		} catch (error) {
			console.error("[WHATSAPP_DELIVERY_STATUS_ERROR]", {
					metaMessageId,
					status: deliveryStatus,
					error: sanitizeWhatsAppLogValue(
						error instanceof Error ? error.message : String(error)
					),
			});
		}
	}

}

async function verifyWhatsAppWebhookSignature(
	rawBody: string,
	signature: string,
	appSecret: string
): Promise<boolean> {
	const suppliedSignature = signature.startsWith("sha256=")
		? signature.slice("sha256=".length)
		: "";
	if (!suppliedSignature) return false;

	const key = await crypto.subtle.importKey(
		"raw",
		new TextEncoder().encode(appSecret),
		{ name: "HMAC", hash: "SHA-256" },
		false,
		["sign"]
	);
	const digest = await crypto.subtle.sign(
		"HMAC",
		key,
		new TextEncoder().encode(rawBody)
	);
	return safeCompare(bytesToHex(digest), suppliedSignature.toLowerCase());
}

async function sendWhatsAppPayload(
	payload: Record<string, unknown>,
	env: Env
): Promise<WhatsAppSendResult> {
	const apiUrl = `https://graph.facebook.com/v21.0/${env.PHONE_NUMBER_ID}/messages`;

	const response = await fetch(apiUrl, {
		method: "POST",
		headers: {
			Authorization: `Bearer ${env.WHATSAPP_TOKEN}`,
			"Content-Type": "application/json",
		},
		body: JSON.stringify(payload),
	});

	const responseBody = await response.text();
	let responseData: Record<string, unknown> | null = null;
	try {
		responseData = JSON.parse(responseBody) as Record<string, unknown>;
	} catch {
		// Keep the raw response text for the diagnostic log.
	}
	const responseMessages = responseData?.messages as Array<{ id?: string }> | undefined;
	const recipient = typeof payload.to === "string" ? payload.to : "";
	const result: WhatsAppSendResult = {
		endpoint: apiUrl,
		httpStatus: response.status,
		responseBody: responseData
			? sanitizeWhatsAppLogValue(responseData)
			: recipient
				? responseBody.replaceAll(recipient, maskPhoneNumber(recipient))
				: responseBody,
		metaMessageId: responseMessages?.[0]?.id ?? null,
	};
	console.log("[WHATSAPP_API_RESPONSE]", {
		...result,
		recipient: maskPhoneNumber(recipient),
		payload: sanitizeWhatsAppLogValue(payload),
	});

	if (!response.ok) {
		throw new Error(
			JSON.stringify({
				error: "WhatsApp API request rejected",
				endpoint: result.endpoint,
				httpStatus: result.httpStatus,
				responseBody: result.responseBody,
				metaMessageId: result.metaMessageId,
				recipient: maskPhoneNumber(recipient),
				payload: sanitizeWhatsAppLogValue(payload),
			})
		);
	}
	return result;
}

async function sendWhatsAppMessage(
	to: string,
	message: string,
	env: Env
): Promise<WhatsAppSendResult> {
	return sendWhatsAppPayload(
		{
			messaging_product: "whatsapp",
			recipient_type: "individual",
			to,
			type: "text",
			text: {
				preview_url: true,
				body: message,
			},
		},
		env
	);
}

type DeliveryCollectionStep =
	| "CHOICE"
	| "ADDRESS_CHOICE"
	| "ADDRESS_FORM"
	| "ADDRESS_CONFIRM"
	| "FLOW_WAIT"
	| "FLOW_SAVED"
	| "RECIPIENT_NAME"
	| "RECIPIENT_PHONE"
	| "EMAIL"
	| "ADDRESS_LINE_1"
	| "ADDRESS_LINE_2"
	| "CITY"
	| "STATE"
	| "PINCODE"
	| "LANDMARK";

const DELIVERY_STEP_ORDER: readonly string[] = [
	"RECIPIENT_NAME",
	"RECIPIENT_PHONE",
	"EMAIL",
	"ADDRESS_LINE_1",
	"ADDRESS_LINE_2",
	"CITY",
	"STATE",
	"PINCODE",
	"LANDMARK",
];

function formatDeliveryAddress(address: Partial<DeliveryAddressInput>): string {
	return [
		address.recipient_name && `Name: ${address.recipient_name}`,
		address.recipient_phone && `Phone: ${address.recipient_phone}`,
		address.email && `Email: ${address.email}`,
		address.address_line_1 && `Address: ${address.address_line_1}`,
		address.address_line_2 && `Address Line 2: ${address.address_line_2}`,
		address.city && `City: ${address.city}`,
		address.state && `State: ${address.state}`,
		address.pincode && `Pincode: ${address.pincode}`,
		address.landmark && `Landmark: ${address.landmark}`,
	].filter((line): line is string => Boolean(line)).join("\n");
}

async function sendDeliveryAddressChoicePrompt(
	to: string,
	address: DeliveryAddressRecord,
	env: Env
): Promise<void> {
	await sendWhatsAppPayload(
		{
			messaging_product: "whatsapp",
			recipient_type: "individual",
			to,
			type: "interactive",
			interactive: {
				type: "button",
				body: {
					text: [
						"A saved delivery address is available:",
						"",
						formatDeliveryAddress(address),
						"",
						"Use this address or add a new one?",
					].join("\n"),
				},
				action: {
					buttons: [
						{ type: "reply", reply: { id: "DELIVERY_USE_EXISTING", title: "Use Existing Address" } },
						{ type: "reply", reply: { id: "DELIVERY_ADD_NEW", title: "Add New Address" } },
					],
				},
			},
		},
		env
	);
}

async function sendDeliveryChoicePrompt(
	to: string,
	orderId: number,
	totalAmount: number,
	env: Env
): Promise<void> {
	await sendWhatsAppPayload(
		{
			messaging_product: "whatsapp",
			recipient_type: "individual",
			to,
			type: "interactive",
			interactive: {
				type: "button",
				body: {
					text: [
						"✅ Payment received!",
						"",
						`Order #${orderId} is confirmed. Amount paid: ₹${totalAmount}.`,
						"",
						"Would you like to add delivery details for this order?",
					].join("\n"),
				},
				action: {
					buttons: [
						{ type: "reply", reply: { id: "DELIVERY_DETAILS_YES", title: "Yes" } },
						{ type: "reply", reply: { id: "DELIVERY_DETAILS_NO", title: "No" } },
					],
				},
			},
		},
		env
	);
}

async function ensureDeliveryFollowUp(
	orderId: number,
	customerPhone: string,
	env: Env
): Promise<SupportTicketRecord> {
	const client = getAdminClient(env);
	const { data: existing, error: lookupError } = await client
		.from("support_tickets")
		.select("*")
		.eq("order_id", orderId)
		.eq("issue_type", "DELIVERY_DETAILS_PENDING")
		.in("status", ["OPEN", "IN_PROGRESS", "WAITING_CUSTOMER", "WAITING_AGENT"])
		.order("created_at", { ascending: false })
		.limit(1)
		.maybeSingle();

	if (lookupError) {
		throw new Error(`Delivery follow-up lookup failed: ${lookupError.message}`);
	}
	if (existing) {
		return existing as SupportTicketRecord;
	}

	return createSupportTicket(
		{
			customerPhone,
			orderId,
			issueType: "DELIVERY_DETAILS_PENDING",
			issueDescription: "Customer declined to enter delivery details after payment. Customer care must collect the recipient and delivery address.",
			priority: "NORMAL",
		},
		env
	);
}

async function handleLegacyDeliveryConversation(
	sender: string,
	incomingText: string,
	buttonId: string,
	env: Env
): Promise<boolean> {
	const conversation = await getConversationState(sender, env);
	if (!conversation || conversation.state !== "DELIVERY_DETAILS") {
		return false;
	}

	const context = conversation.context ?? {};
	if (context.step !== "CHOICE") {
		throw new Error("Text-based delivery address collection is disabled; launch the WhatsApp Flow");
	}
	const orderId = Number(context.order_id);
	if (!Number.isSafeInteger(orderId) || orderId <= 0) {
		throw new Error(`Invalid persisted delivery order for ${sender}`);
	}

	const answer = incomingText.trim();
	if (!answer && !buttonId) {
		await sendWhatsAppMessage(sender, "Please choose Yes or No to continue.", env);
		return true;
	}

	const choice = buttonId === "DELIVERY_DETAILS_YES" || /^(yes|y|yeah|yep)$/i.test(answer)
		? "YES"
		: buttonId === "DELIVERY_DETAILS_NO" || /^(no|n|nope)$/i.test(answer)
			? "NO"
			: null;
	if (!choice) {
		await sendWhatsAppMessage(sender, "Please choose Yes or No to continue.", env);
		return true;
	}

	await setOrderDeliveryResponse(orderId, choice, env);
	if (choice === "NO") {
		const { data: order, error } = await getAdminClient(env)
			.from("orders")
			.select("customer_phone")
			.eq("id", orderId)
			.eq("customer_phone", sender)
			.maybeSingle();
		if (error || !order) {
			throw new Error(`Delivery follow-up order lookup failed: ${error?.message ?? "Order not found for this customer"}`);
		}

		const ticket = await ensureDeliveryFollowUp(orderId, sender, env);
		await upsertConversationState(sender, "MAIN_MENU", env, {}, answer || buttonId);
		await sendWhatsAppMessage(
			sender,
			[
				"Thank you. Our customer care team will contact you shortly to collect delivery details and schedule the delivery.",
				"",
				`Follow-up reference: ${ticket.ticket_number}`,
			].join("\n"),
			env
		);
		return true;
	}

	await sendAddressOptionsForOrder(sender, orderId, env);
	return true;
}

function choosePreferredDeliveryAddress(
	addresses: DeliveryAddressRecord[]
): DeliveryAddressRecord | null {
	const activeAddresses = addresses.filter((address) => address.is_active !== false);
	return activeAddresses.find((address) => address.is_default) ?? activeAddresses[0] ?? null;
}

async function sendAddressOptionsForOrder(
	sender: string,
	orderId: number,
	env: Env
): Promise<void> {
	const { data: order, error } = await getAdminClient(env)
		.from("orders")
		.select("customer_id, customer_phone")
		.eq("id", orderId)
		.eq("customer_phone", sender)
		.maybeSingle();
	if (error || !order) {
		throw new Error(`Delivery order lookup failed: ${error?.message ?? "Order not found for this customer"}`);
	}

	const customer = order.customer_id
		? null
		: await upsertCustomer(String(order.customer_phone), env);
	const customerId = Number(order.customer_id ?? customer?.id);
	const address = choosePreferredDeliveryAddress(
		await getCustomerDeliveryAddresses(customerId, env)
	);
	const context = {
		source: "PAYMENT_SUCCESS_DELIVERY",
		order_id: orderId,
		customer_id: customerId,
	};

	if (address) {
		await upsertConversationState(
			sender,
			"DELIVERY_DETAILS",
			env,
			{ ...context, step: "ADDRESS_CHOICE", address_id: address.id },
			"yes"
		);
		await sendDeliveryAddressChoicePrompt(sender, address, env);
		return;
	}

	await upsertConversationState(
		sender,
		"DELIVERY_DETAILS",
		env,
		{ ...context, step: "FLOW_WAIT" },
		"yes"
	);
	await sendDeliveryFlowPrompt(sender, context, env);
}

async function startCheckoutAddressCollection(
	sender: string,
	messageId: string,
	env: Env
): Promise<void> {
	const { items } = await viewCart(sender, env);
	if (!items.length) {
		await sendWhatsAppMessage(sender, "Your cart is empty. Select View Products to add items.", env);
		return;
	}

	const customer = await upsertCustomer(sender, env);
	const address = choosePreferredDeliveryAddress(
		await getCustomerDeliveryAddresses(customer.id, env)
	);
	const context = {
		source: "CHECKOUT_DELIVERY",
		customer_id: customer.id,
		cart_checkout: true,
		checkout_message_id: messageId,
	};

	if (address) {
		await upsertConversationState(
			sender,
			"DELIVERY_DETAILS",
			env,
			{ ...context, step: "ADDRESS_CHOICE", address_id: address.id },
			messageId
		);
		await sendDeliveryAddressChoicePrompt(sender, address, env);
		return;
	}

	await upsertConversationState(
		sender,
		"DELIVERY_DETAILS",
		env,
		{ ...context, step: "FLOW_WAIT" },
		messageId
	);
	await sendDeliveryFlowPrompt(sender, context, env);
}

async function sendDeliveryFlowPrompt(
	sender: string,
	context: Record<string, unknown>,
	env: Env
): Promise<void> {
	const flowId = env.WHATSAPP_DELIVERY_FLOW_ID?.trim();
	if (!flowId) {
		console.error("[FLOW] Flow not configured", {
			recipient: maskPhoneNumber(sender),
		});
		await leaveFlowUnavailableState(sender, context, env);
		await sendWhatsAppMessage(
			sender,
			"Delivery Address Flow is not configured right now. Please try again later.",
			env
		);
		throw new Error("Flow not configured");
	}

	const payload = buildDeliveryAddressFlowMessage(sender, flowId, crypto.randomUUID());
	console.log("[FLOW] Launching delivery address flow", {
		recipient: maskPhoneNumber(sender),
	});
	console.log("[FLOW] Flow ID:", flowId);
	console.log("[FLOW] Payload sent to Meta:", JSON.stringify({
		...payload,
		to: maskPhoneNumber(sender),
	}));

	try {
		const result = await sendWhatsAppPayload(payload, env);
		console.log("[FLOW] WhatsApp response:", {
			endpoint: result.endpoint,
			httpStatus: result.httpStatus,
			responseBody: result.responseBody,
			metaMessageId: result.metaMessageId,
		});
	} catch (error) {
		console.error("[FLOW] WhatsApp response:", {
			error: error instanceof Error ? error.message : String(error),
			recipient: maskPhoneNumber(sender),
		});
		await leaveFlowUnavailableState(sender, context, env);
		await sendWhatsAppMessage(
			sender,
			"Delivery Address Flow could not be opened. Please try again later.",
			env
		);
		throw error;
	}
}

async function leaveFlowUnavailableState(
	sender: string,
	context: Record<string, unknown>,
	env: Env
): Promise<void> {
	const savedAddressId = Number(context.address_id);
	if (Number.isSafeInteger(savedAddressId) && savedAddressId > 0) {
		await upsertConversationState(
			sender,
			"DELIVERY_DETAILS",
			env,
			{ ...context, step: "ADDRESS_CHOICE" },
			"flow_unavailable"
		);
		return;
	}
	await upsertConversationState(sender, "MAIN_MENU", env, {}, "flow_unavailable");
}

async function finishCheckoutWithDeliveryAddress(
	sender: string,
	messageId: string,
	addressId: number,
	env: Env
): Promise<void> {
	const { order } = await createOrderFromCart(sender, env, messageId);
	await ensurePendingOrderDelivery(order.id, env);
	const { address } = await linkSavedDeliveryAddressToOrder(order.id, sender, addressId, env);

	const paymentLink = await createCommercePaymentLink(order, env);
	await updateOrderPaymentLink(order.id, paymentLink.id, paymentLink.short_url, env);
	await upsertConversationState(sender, "MAIN_MENU", env, {}, messageId);
	await sendWhatsAppMessage(
		sender,
		[
			"🧾 Order created",
			"",
			`Order: #${order.id}`,
			"",
			"Delivery address confirmed:",
			formatDeliveryAddress(address),
			"",
			"Complete your payment:",
			paymentLink.short_url,
		].join("\n"),
		env
	);
}

async function startDeliveryAddressFlow(
	sender: string,
	context: Record<string, unknown>,
	messageId: string,
	env: Env
): Promise<void> {
	const flowContext = { ...context, step: "FLOW_WAIT", delivery: {} };
	await upsertConversationState(
		sender,
		"DELIVERY_DETAILS",
		env,
		flowContext,
		messageId
	);
	await sendDeliveryFlowPrompt(sender, flowContext, env);
}

async function handleDeliveryFlowSubmission(
	sender: string,
	responseJson: string,
	env: Env,
	messageId: string
): Promise<boolean> {
	const conversation = await getConversationState(sender, env);
	if (!conversation || conversation.state !== "DELIVERY_DETAILS") {
		console.warn("[WHATSAPP_FLOW_SUBMISSION_IGNORED]", {
			reason: "No active delivery address Flow conversation",
			recipient: maskPhoneNumber(sender),
		});
		return true;
	}

	const context = conversation.context ?? {};
	if (context.step === "FLOW_SAVED") {
		console.info("[WHATSAPP_FLOW_SUBMISSION_IGNORED]", {
			reason: "Flow submission was already persisted",
			recipient: maskPhoneNumber(sender),
		});
		return true;
	}
	if (context.step !== "FLOW_WAIT") {
		console.warn("[WHATSAPP_FLOW_SUBMISSION_IGNORED]", {
			reason: "Delivery conversation is not waiting for a Flow submission",
			recipient: maskPhoneNumber(sender),
		});
		return true;
	}

	let address: DeliveryAddressInput;
	try {
		address = parseDeliveryAddressFlowSubmission(responseJson);
	} catch (error) {
		const validationMessage = error instanceof Error ? error.message : "The address details are invalid.";
		console.warn("[WHATSAPP_FLOW_VALIDATION_ERROR]", {
			error: validationMessage,
			recipient: maskPhoneNumber(sender),
		});
		await upsertConversationState(
			sender,
			"DELIVERY_DETAILS",
			env,
			{ ...context, step: "FLOW_WAIT", delivery: {} },
			messageId
		);
		await sendWhatsAppMessage(
			sender,
			`The address details could not be validated (${validationMessage}). Please submit the Delivery Address form again.`,
			env
		);
		await sendDeliveryFlowPrompt(sender, context, env);
		return true;
	}

	const customerId = Number(context.customer_id);
	if (!Number.isSafeInteger(customerId) || customerId <= 0) {
		throw new Error("Customer is missing from delivery Flow context");
	}
	const updateAddressId = Number(context.update_address_id);
	const addressRecord = await saveDeliveryAddressForCustomer(
		customerId,
		address,
		env,
		Number.isSafeInteger(updateAddressId) && updateAddressId > 0
			? updateAddressId
			: undefined
	);
	const savedContext = {
		...context,
		step: "FLOW_SAVED",
		address_id: addressRecord.id,
		delivery: address,
	};
	await upsertConversationState(sender, "DELIVERY_DETAILS", env, savedContext, messageId);

	if (context.source === "CHECKOUT_DELIVERY") {
		await finishCheckoutWithDeliveryAddress(sender, messageId, addressRecord.id, env);
		return true;
	}

	const orderId = Number(context.order_id);
	if (!Number.isSafeInteger(orderId) || orderId <= 0) {
		throw new Error("Order is missing from delivery Flow context");
	}
	const linked = await linkSavedDeliveryAddressToOrder(orderId, sender, addressRecord.id, env);
	await upsertConversationState(sender, "MAIN_MENU", env, {}, messageId);
	await sendWhatsAppMessage(
		sender,
		[
			`✅ Delivery address confirmed for order #${orderId}.`,
			"",
			formatDeliveryAddress(linked.address),
		].join("\n"),
		env
	);
	return true;
}

async function handleDeliveryConversation(
	sender: string,
	incomingText: string,
	buttonId: string,
	env: Env,
	messageId = crypto.randomUUID()
): Promise<boolean> {
	const conversation = await getConversationState(sender, env);
	if (!conversation || conversation.state !== "DELIVERY_DETAILS") {
		return false;
	}

	const context = conversation.context ?? {};
	const step = String(context.step ?? "") as DeliveryCollectionStep;
	const answer = incomingText.trim();
	if (step === "FLOW_WAIT" || step === "FLOW_SAVED") {
		if (step === "FLOW_SAVED") {
			await sendWhatsAppMessage(sender, "Your delivery address has been saved. Please wait while checkout continues.", env);
			return true;
		}
		await sendWhatsAppMessage(
			sender,
			"Please complete the Delivery Address form to continue. No text address form is active.",
			env
		);
		return true;
	}
	if (
		step === "ADDRESS_FORM" ||
		step === "ADDRESS_CONFIRM" ||
		DELIVERY_STEP_ORDER.includes(step)
	) {
		await startDeliveryAddressFlow(sender, context, messageId, env);
		return true;
	}
	if (step === "CHOICE") {
		const choice = buttonId === "DELIVERY_DETAILS_YES" || /^(yes|y|yeah|yep)$/i.test(answer)
			? "YES"
			: buttonId === "DELIVERY_DETAILS_NO" || /^(no|n|nope)$/i.test(answer)
				? "NO"
				: null;
		if (!choice) {
			await sendWhatsAppMessage(sender, "Please choose Yes or No to continue.", env);
			return true;
		}
		if (choice === "NO") {
			return handleLegacyDeliveryConversation(sender, incomingText, buttonId, env);
		}

		const orderId = Number(context.order_id);
		if (!Number.isSafeInteger(orderId) || orderId <= 0) {
			throw new Error(`Invalid persisted delivery order for ${sender}`);
		}
		await setOrderDeliveryResponse(orderId, "YES", env);
		await sendAddressOptionsForOrder(sender, orderId, env);
		return true;
	}

	if (step === "ADDRESS_CHOICE") {
		const useExisting = buttonId === "DELIVERY_USE_EXISTING" || /^(use existing|existing)$/i.test(answer);
		const addNew = buttonId === "DELIVERY_ADD_NEW" || /^(add new|new address)$/i.test(answer);
		if (!useExisting && !addNew) {
			const addressId = Number(context.address_id);
			const addresses = Number.isSafeInteger(addressId)
				? await getCustomerDeliveryAddresses(Number(context.customer_id), env)
				: [];
			const address = addresses.find((item) => item.id === addressId);
			if (address) {
				await sendDeliveryAddressChoicePrompt(sender, address, env);
			} else {
				await startDeliveryAddressFlow(sender, context, buttonId || answer, env);
			}
			return true;
		}

		if (addNew) {
			await startDeliveryAddressFlow(sender, context, answer || buttonId, env);
			return true;
		}

		const addressId = Number(context.address_id);
		if (!Number.isSafeInteger(addressId) || addressId <= 0) {
			throw new Error("No saved delivery address is selected");
		}
		if (context.source === "CHECKOUT_DELIVERY") {
			await finishCheckoutWithDeliveryAddress(sender, messageId, addressId, env);
			return true;
		}

		const orderId = Number(context.order_id);
		const linked = await linkSavedDeliveryAddressToOrder(orderId, sender, addressId, env);
		await upsertConversationState(sender, "MAIN_MENU", env, {}, answer || buttonId);
		await sendWhatsAppMessage(
			sender,
			`✅ Saved delivery address linked to order #${orderId}.\nRecipient: ${linked.address.recipient_name}`,
			env
		);
		return true;
	}

	throw new Error(`Unsupported persisted delivery conversation step: ${step}`);
}

const CUSTOMER_NOTIFICATION_STATUSES: Record<string, {
	messageType: string;
	currentStatus: string;
	message: (orderId: number) => string;
}> = {
	pending: {
		messageType: "ORDER_PLACED",
		currentStatus: "Order placed",
		message: (orderId) => `Your order #${orderId} has been placed successfully.`,
	},
	paid: {
		messageType: "ORDER_PLACED",
		currentStatus: "Order placed",
		message: (orderId) => `Your order #${orderId} has been placed successfully.`,
	},
	PACKED: {
		messageType: "PROCESSING",
		currentStatus: "Processing",
		message: (orderId) => `Your order #${orderId} is now being processed.`,
	},
	SHIPPED: {
		messageType: "SHIPPED",
		currentStatus: "Shipped",
		message: (orderId) => `Your order #${orderId} has been shipped.`,
	},
	OUT_FOR_DELIVERY: {
		messageType: "OUT_FOR_DELIVERY",
		currentStatus: "Out for delivery",
		message: (orderId) => `Your order #${orderId} is out for delivery.`,
	},
	DELIVERED: {
		messageType: "DELIVERED",
		currentStatus: "Delivered",
		message: (orderId) => `Your order #${orderId} has been delivered.`,
	},
	fulfilled: {
		messageType: "DELIVERED",
		currentStatus: "Delivered",
		message: (orderId) => `Your order #${orderId} has been delivered.`,
	},
	cancelled: {
		messageType: "CANCELLED",
		currentStatus: "Cancelled",
		message: (orderId) => `Your order #${orderId} has been cancelled.`,
	},
};

async function sendOrderStatusNotification(
	order: Pick<Order, "id" | "status" | "customer_id" | "customer_phone">,
	previousStatus: string,
	env: Env
): Promise<void> {
	const orderId = order.id;
	const status = order.status as OrderStatus;
	const message = CUSTOMER_NOTIFICATION_STATUSES[status];
	const client = getAdminClient(env);
	if (!message) {
		console.log("[NOTIFICATION]", {
			orderId,
			status,
			messageType: null,
			messageSent: false,
			reason: "No customer message is configured for this status",
		});
		try {
			const { data: event } = await client
				.from("notification_events")
				.select("id")
				.eq("order_id", orderId)
				.eq("related_status", status)
				.eq("status", "queued")
				.order("created_at", { ascending: false })
				.limit(1)
				.maybeSingle();
			if (event) {
				const { error } = await client
					.from("notification_events")
					.update({
						status: "skipped",
						reason: "No customer message is configured for this status",
					})
					.eq("id", event.id)
					.eq("status", "queued");
				if (error) {
					console.error("[NOTIFICATION_ERROR]", {
						orderId,
						stage: "mark_skipped",
						error: error.message,
					});
				}
			}
		} catch (error) {
			console.error("[NOTIFICATION_ERROR]", {
				orderId,
				stage: "mark_skipped",
				error: error instanceof Error ? error.message : String(error),
			});
		}
		return;
	}

	let event: { id: number; payload: Record<string, unknown> | null } | null = null;
	let customer: { name: string | null; whatsapp_number: string } | null = null;

	try {
		const customerQuery = client
			.from("customers")
			.select("name, whatsapp_number");
		let customerResult;
		if (order.customer_id != null) {
			customerResult = await customerQuery
				.eq("id", order.customer_id)
				.maybeSingle();
			if (!customerResult.data && order.customer_phone) {
				customerResult = await client
					.from("customers")
					.select("name, whatsapp_number")
					.eq("whatsapp_number", order.customer_phone)
					.maybeSingle();
			}
		} else if (order.customer_phone) {
			customerResult = await customerQuery
				.eq("whatsapp_number", order.customer_phone)
				.maybeSingle();
		}

		if (customerResult?.error) {
			console.error("[NOTIFICATION_ERROR]", {
				orderId,
				stage: "customer_lookup",
				error: customerResult.error.message,
			});
		} else {
			customer = customerResult?.data ?? null;
		}
	} catch (error) {
		console.error("[NOTIFICATION_ERROR]", {
			orderId,
			stage: "customer_lookup",
			error: error instanceof Error ? error.message : String(error),
		});
	}

	const recipientPhone = order.customer_phone || customer?.whatsapp_number || "";
	if (!recipientPhone) {
		console.error("[NOTIFICATION_ERROR]", {
			orderId,
			messageType: message.messageType,
			error: "Customer phone number is missing for this order",
		});
		return;
	}

	try {
		const { data: eventRecord, error: eventLookupError } = await client
			.from("notification_events")
			.select("id, payload")
			.eq("order_id", orderId)
			.eq("related_status", status)
			.eq("status", "queued")
			.order("created_at", { ascending: false })
			.limit(1)
			.maybeSingle();
		if (eventLookupError) {
			console.error("[NOTIFICATION_ERROR]", {
				orderId,
				stage: "event_lookup",
				error: eventLookupError.message,
			});
		} else {
			event = eventRecord;
		}
	} catch (error) {
		console.error("[NOTIFICATION_ERROR]", {
			orderId,
			stage: "event_lookup",
			error: error instanceof Error ? error.message : String(error),
		});
	}

	const customerName = customer?.name?.trim() || "there";
	const customerMessage = [
		`Hi ${customerName}, ${message.message(orderId)}`,
		`Current status: ${message.currentStatus}.`,
	].join("\n");
	const payload = {
		...((event?.payload as Record<string, unknown> | null) ?? {}),
		customer_name: customerName,
		order_id: orderId,
		previous_status: previousStatus,
		new_status: status,
		message_type: message.messageType,
		message: customerMessage,
	};

	try {
		console.log("[NOTIFICATION]", {
			orderId,
			phoneNumber: maskPhoneNumber(recipientPhone),
			messageType: message.messageType,
			messageSent: false,
			stage: "sending",
		});
		const sendResult = await sendWhatsAppMessage(
			recipientPhone,
			customerMessage,
			env
		);
		console.log("[NOTIFICATION]", {
			orderId,
			phoneNumber: maskPhoneNumber(recipientPhone),
			messageType: message.messageType,
			messageSent: true,
		});

		if (event) {
			try {
				const { error: sentUpdateError } = await client
					.from("notification_events")
					.update({
						status: "sent",
						payload: {
							...payload,
							meta_message_id: sendResult.metaMessageId,
							delivery_status: "sent",
						},
						sent_at: new Date().toISOString(),
						updated_at: new Date().toISOString(),
					})
					.eq("id", event.id)
					.eq("status", "queued");
				if (sentUpdateError) throw new Error(sentUpdateError.message);
			} catch (error) {
				console.error("[NOTIFICATION_ERROR]", {
					orderId,
					messageType: message.messageType,
					stage: "mark_sent",
					error: error instanceof Error ? error.message : String(error),
				});
			}
		}
	} catch (error) {
		const errorDetails = error instanceof Error ? error.message : String(error);
		console.error("[NOTIFICATION_ERROR]", {
			orderId,
			phoneNumber: maskPhoneNumber(order.customer_phone || ""),
			messageType: message.messageType,
			error: errorDetails,
		});

		if (event) {
			try {
				const { error: failedUpdateError } = await client
					.from("notification_events")
					.update({
						status: "failed",
						reason: errorDetails,
						updated_at: new Date().toISOString(),
					})
					.eq("id", event.id)
					.eq("status", "queued");
				if (failedUpdateError) throw new Error(failedUpdateError.message);
			} catch (updateError) {
				console.error("[NOTIFICATION_ERROR]", {
					orderId,
					messageType: message.messageType,
					stage: "mark_failed",
					error: updateError instanceof Error ? updateError.message : String(updateError),
				});
			}
		}
	}
}

const SUPPORT_TICKET_NOTIFICATION_MESSAGES: Record<string, string> = {
	"OPEN->IN_PROGRESS": [
		"📢 Ticket Update",
		"",
		"Status: IN_PROGRESS",
		"",
		"Our support team is reviewing your request.",
	].join("\n"),
	"OPEN->WAITING_CUSTOMER": [
		"📢 Ticket Update",
		"",
		"Status: WAITING_CUSTOMER",
		"",
		"We need additional information from you.",
	].join("\n"),
	"IN_PROGRESS->RESOLVED": [
		"✅ Ticket Resolved",
		"",
		"Your issue has been resolved.",
	].join("\n"),
	"RESOLVED->CLOSED": [
		"✅ Ticket Closed",
		"",
		"This support request has been closed.",
	].join("\n"),
};

async function sendSupportTicketStatusNotification(
	previousStatus: SupportTicketStatus,
	ticket: {
		id: number;
		ticket_number: string;
		customer_phone: string;
		order_id: number | null;
		status: SupportTicketStatus;
	},
	env: Env
): Promise<void> {
	const transition = `${previousStatus}->${ticket.status}`;
	const notificationMessage = SUPPORT_TICKET_NOTIFICATION_MESSAGES[transition];

	if (!notificationMessage) {
		return;
	}

	const client = getAdminClient(env);
	const payload = {
		ticket_id: ticket.id,
		ticket_number: ticket.ticket_number,
		previous_status: previousStatus,
		status: ticket.status,
	};

	const { data: existingEvent, error: lookupError } = await client
		.from("notification_events")
		.select("id, status")
		.eq("event_type", "support_ticket_status_changed")
		.contains("payload", payload)
		.in("status", ["queued", "sent"])
		.limit(1)
		.maybeSingle();

	if (lookupError) {
		console.error("[SUPPORT TICKET NOTIFICATION] Duplicate check failed:", lookupError);
		return;
	}

	if (existingEvent) {
		console.log("[SUPPORT TICKET NOTIFICATION] Duplicate notification skipped", {
			ticketId: ticket.id,
			ticketNumber: ticket.ticket_number,
			transition,
			eventId: existingEvent.id,
		});
		return;
	}

	const { data: event, error: insertError } = await client
		.from("notification_events")
		.insert({
			order_id: ticket.order_id,
			customer_phone: ticket.customer_phone,
			event_type: "support_ticket_status_changed",
			channel: "whatsapp",
			status: "queued",
			related_status: ticket.status,
			payload,
		})
		.select("id")
		.single();

	if (insertError || !event) {
		console.error("[SUPPORT TICKET NOTIFICATION] Event creation failed:", insertError);
		return;
	}

	const message = [
		notificationMessage,
		"",
		`Ticket Number: ${ticket.ticket_number}`,
	].join("\n");

	try {
		console.log("[SUPPORT TICKET NOTIFICATION] Sending WhatsApp message", {
			ticketId: ticket.id,
			ticketNumber: ticket.ticket_number,
			transition,
			eventId: event.id,
		});
		await sendWhatsAppMessage(ticket.customer_phone, message, env);

		const { error: sentError } = await client
			.from("notification_events")
			.update({
				status: "sent",
				sent_at: new Date().toISOString(),
				updated_at: new Date().toISOString(),
			})
			.eq("id", event.id)
			.eq("status", "queued");

		console.log("[SUPPORT TICKET NOTIFICATION] Sent-state update result", {
			ticketId: ticket.id,
			eventId: event.id,
			success: !sentError,
			error: sentError?.message ?? null,
		});
	} catch (error) {
		console.error("[SUPPORT TICKET NOTIFICATION] WhatsApp delivery failed:", error);
		const { error: failedError } = await client
			.from("notification_events")
			.update({
				status: "failed",
				reason: error instanceof Error ? error.message : "WhatsApp delivery failed",
				updated_at: new Date().toISOString(),
			})
			.eq("id", event.id)
			.eq("status", "queued");

		console.log("[SUPPORT TICKET NOTIFICATION] Failed-state update result", {
			ticketId: ticket.id,
			eventId: event.id,
			success: !failedError,
			error: failedError?.message ?? null,
		});
	}
}

/*
|--------------------------------------------------------------------------
| Main menu
|--------------------------------------------------------------------------
*/

async function sendMainMenuButtons(
	to: string,
	env: Env
): Promise<void> {
	await sendWhatsAppPayload(
		{
			messaging_product: "whatsapp",
			recipient_type: "individual",
			to,
			type: "interactive",
			interactive: {
				type: "button",
				header: {
					type: "text",
					text: "Innova Solutions",
				},
				body: {
					text: [
						"Welcome to Innova Solutions!",
						"",
						"How can we help you today?",
					].join("\n"),
				},
				footer: {
					text: "Select one option below",
				},
				action: {
					buttons: [
						{
							type: "reply",
							reply: {
								id: "VIEW_PRODUCTS",
								title: "View Products",
							},
						},
						{
							type: "reply",
							reply: {
								id: "TRACK_ORDER",
								title: "Track Order",
							},
						},
						{
							type: "reply",
							reply: {
								id: "CUSTOMER_CARE",
								title: "Customer Care",
							},
						},
					],
				},
			},
		},
		env
	);

	console.log("Interactive main menu sent");
}

/*
|--------------------------------------------------------------------------
| Customer Care template
|--------------------------------------------------------------------------
|
| This requires an approved Meta template:
|
| Name: innova_customer_care
| Language code: en
| CTA: Call phone number
| Phone: +914023393703
|
|--------------------------------------------------------------------------
*/

async function sendCustomerCareMessage(
	to: string,
	env: Env
): Promise<void> {
	await sendWhatsAppMessage(
		to,
		[
			"☎️ Innova Solutions Customer Care",
			"",
			"Tap the link below to call:",
			"tel:+914023393703",
			"",
			"Customer Care: +91 40 2339 3703",
		].join("\n"),
		env
	);

	console.log(
		"Customer Care number sent"
	);
}

/*
|--------------------------------------------------------------------------
| Product list
|--------------------------------------------------------------------------
*/

async function sendProductList(
	to: string,
	env: Env
): Promise<void> {
	const supabase = getPublicClient(env);

	const { data, error } = await supabase
		.from("products")
		.select(
			"id, name, price, description, stock"
		)
		.gt("stock", 0)
		.order("id", {
			ascending: true,
		})
		.limit(10);

	if (error) {
		console.error(
			"Product list query failed:",
			error
		);

		await sendWhatsAppMessage(
			to,
			[
				"Sorry, products could not be loaded.",
				"Please try again shortly.",
			].join("\n"),
			env
		);

		return;
	}

	const products =
		(data ?? []) as unknown as Product[];

	if (products.length === 0) {
		await sendWhatsAppMessage(
			to,
			"No products are currently available.",
			env
		);

		return;
	}

	const rows = products.map((product) => ({
		id: `ADD_PRODUCT_${product.id}`,
		title: product.name.slice(0, 24),
		description:
			`₹${product.price} | Stock: ${product.stock}`.slice(
				0,
				72
			),
	}));

	await sendWhatsAppPayload(
		{
			messaging_product: "whatsapp",
			recipient_type: "individual",
			to,
			type: "interactive",
			interactive: {
				type: "list",
				header: {
					type: "text",
					text: "Innova Solutions",
				},
				body: {
					text:
						"Select a product to add it to your cart.",
				},
				footer: {
					text:
						"You can add multiple products one by one.",
				},
				action: {
					button: "View Products",
					sections: [
						{
							title: "Available Products",
							rows,
						},
					],
				},
			},
		},
		env
	);

	console.log(
		"Interactive product list sent"
	);
}

/*
|--------------------------------------------------------------------------
| Cart helpers
|--------------------------------------------------------------------------
*/

async function getActiveCart(
	customerPhone: string,
	env: Env
): Promise<Cart | null> {
	const supabase = getAdminClient(env);

	const { data, error } = await supabase
		.from("carts")
		.select(
			"id, customer_phone, status, created_at, updated_at"
		)
		.eq("customer_phone", customerPhone)
		.eq("status", "active")
		.maybeSingle();

	if (error) {
		console.error(
			"Active cart lookup failed:",
			error
		);

		throw new Error(
			"Could not look up active cart"
		);
	}

	if (!data) {
		return null;
	}

	return data as unknown as Cart;
}

async function getOrCreateActiveCart(
	customerPhone: string,
	env: Env
): Promise<Cart> {
	const existingCart =
		await getActiveCart(
			customerPhone,
			env
		);

	if (existingCart) {
		return existingCart;
	}

	const supabase = getAdminClient(env);

	const { data, error } = await supabase
		.from("carts")
		.insert({
			customer_phone: customerPhone,
			status: "active",
		})
		.select(
			"id, customer_phone, status, created_at, updated_at"
		)
		.single();

	if (error || !data) {
		console.error(
			"Cart creation failed:",
			error
		);

		/*
		 * A second request may have created the cart
		 * between the lookup and insert.
		 */
		const retryCart =
			await getActiveCart(
				customerPhone,
				env
			);

		if (retryCart) {
			return retryCart;
		}

		throw new Error(
			"Could not create shopping cart"
		);
	}

	return data as unknown as Cart;
}

/*
|--------------------------------------------------------------------------
| Cart action buttons
|--------------------------------------------------------------------------
*/

async function sendCartActions(
	to: string,
	productName: string,
	env: Env
): Promise<void> {
	await sendWhatsAppPayload(
		{
			messaging_product: "whatsapp",
			recipient_type: "individual",
			to,
			type: "interactive",
			interactive: {
				type: "button",
				body: {
					text: [
						`✅ ${productName} was added to your cart.`,
						"",
						"What would you like to do next?",
					].join("\n"),
				},
				footer: {
					text: "Innova Solutions",
				},
				action: {
					buttons: [
						{
							type: "reply",
							reply: {
								id: "ADD_MORE_PRODUCTS",
								title: "Continue Shopping",
							},
						},
						{
							type: "reply",
							reply: {
								id: "VIEW_CART",
								title: "View Cart",
							},
						},
						{
							type: "reply",
							reply: {
								id: "CHECKOUT_CART",
								title: "Checkout",
							},
						},
					],
				},
			},
		},
		env
	);
}

/*
|--------------------------------------------------------------------------
| Add product to cart
|--------------------------------------------------------------------------
*/

async function addProductToCart(
	sender: string,
	productId: number,
	env: Env
): Promise<void> {
	if (
		!Number.isInteger(productId) ||
		productId <= 0
	) {
		await sendWhatsAppMessage(
			sender,
			"That product selection is invalid.",
			env
		);

		return;
	}

	const supabase = getAdminClient(env);

	const {
		data: productData,
		error: productError,
	} = await supabase
		.from("products")
		.select(
			"id, name, price, description, stock"
		)
		.eq("id", productId)
		.maybeSingle();

	if (productError) {
		console.error(
			"Cart product lookup failed:",
			productError
		);

		throw new Error(
			"Could not look up selected product"
		);
	}

	if (!productData) {
		await sendWhatsAppMessage(
			sender,
			"That product could not be found.",
			env
		);

		return;
	}

	const product =
		productData as unknown as Product;

	if (product.stock <= 0) {
		await sendWhatsAppMessage(
			sender,
			`${product.name} is currently out of stock.`,
			env
		);

		return;
	}

	const cart =
		await getOrCreateActiveCart(
			sender,
			env
		);

	const {
		data: existingItemData,
		error: existingItemError,
	} = await supabase
		.from("cart_items")
		.select("id, quantity")
		.eq("cart_id", cart.id)
		.eq("product_id", product.id)
		.maybeSingle();

	if (existingItemError) {
		console.error(
			"Cart-item lookup failed:",
			existingItemError
		);

		throw new Error(
			"Could not check cart item"
		);
	}

	if (existingItemData) {
		const existingItem =
			existingItemData as unknown as ExistingCartItem;

		const newQuantity =
			existingItem.quantity + 1;

		if (newQuantity > product.stock) {
			await sendWhatsAppMessage(
				sender,
				[
					`Only ${product.stock} unit(s) of ${product.name} are available.`,
					"",
					"Please continue with the quantity already in your cart.",
				].join("\n"),
				env
			);

			return;
		}

		const { error: updateError } =
			await supabase
				.from("cart_items")
				.update({
					quantity: newQuantity,
				})
				.eq("id", existingItem.id);

		if (updateError) {
			console.error(
				"Cart quantity update failed:",
				updateError
			);

			throw new Error(
				"Could not update cart quantity"
			);
		}
	} else {
		const { error: insertError } =
			await supabase
				.from("cart_items")
				.insert({
					cart_id: cart.id,
					product_id: product.id,
					product_name: product.name,
					unit_price: product.price,
					quantity: 1,
				});

		if (insertError) {
			console.error(
				"Cart-item insert failed:",
				insertError
			);

			throw new Error(
				"Could not add product to cart"
			);
		}
	}

	await supabase
		.from("carts")
		.update({
			updated_at:
				new Date().toISOString(),
		})
		.eq("id", cart.id);

	await sendCartActions(
		sender,
		product.name,
		env
	);
}

/*
|--------------------------------------------------------------------------
| Load cart items
|--------------------------------------------------------------------------
*/

async function getCartItems(
	cartId: number,
	env: Env
): Promise<CartItem[]> {
	const supabase = getAdminClient(env);

	const { data, error } = await supabase
		.from("cart_items")
		.select(
			"id, cart_id, product_id, product_name, unit_price, quantity"
		)
		.eq("cart_id", cartId)
		.order("id", {
			ascending: true,
		});

	if (error) {
		console.error(
			"Cart-items query failed:",
			error
		);

		throw new Error(
			"Could not load cart items"
		);
	}

	return (data ?? []) as unknown as CartItem[];
}

/*
|--------------------------------------------------------------------------
| Calculate and format cart
|--------------------------------------------------------------------------
*/

function calculateCartTotal(
	items: CartItem[]
): number {
	return items.reduce(
		(total, item) =>
			total +
			item.unit_price * item.quantity,
		0
	);
}

function calculateTotalQuantity(
	items: CartItem[]
): number {
	return items.reduce(
		(total, item) =>
			total + item.quantity,
		0
	);
}

function createCartDescription(
	items: CartItem[]
): string {
	const names = items
		.map((item) => item.product_name)
		.join(", ");

	return names.slice(0, 200);
}

async function sendCartSummary(
	sender: string,
	env: Env
): Promise<void> {
	const cart =
		await getActiveCart(
			sender,
			env
		);

	if (!cart) {
		await sendWhatsAppMessage(
			sender,
			[
				"🛒 Your cart is empty.",
				"",
				"Select View Products to add an item.",
			].join("\n"),
			env
		);

		return;
	}

	const items =
		await getCartItems(
			cart.id,
			env
		);

	if (items.length === 0) {
		await sendWhatsAppMessage(
			sender,
			[
				"🛒 Your cart is empty.",
				"",
				"Select View Products to add an item.",
			].join("\n"),
			env
		);

		return;
	}

	const lines: string[] = [];

	for (const item of items) {
		const lineTotal =
			item.unit_price * item.quantity;

		lines.push(
			`${item.product_name}`,
			`${item.quantity} × ₹${item.unit_price} = ₹${lineTotal}`,
			""
		);
	}

	const total =
		calculateCartTotal(items);

	await sendWhatsAppMessage(
		sender,
		[
			"🛒 Your Cart",
			"",
			...lines,
			`Total: ₹${total}`,
		].join("\n"),
		env
	);

	await sendWhatsAppPayload(
		{
			messaging_product: "whatsapp",
			recipient_type: "individual",
			to: sender,
			type: "interactive",
			interactive: {
				type: "button",
				body: {
					text:
						"What would you like to do?",
				},
				action: {
					buttons: [
						{
							type: "reply",
							reply: {
								id: "ADD_MORE_PRODUCTS",
								title: "Add More",
							},
						},
						{
							type: "reply",
							reply: {
								id: "CHECKOUT_CART",
								title: "Checkout",
							},
						},
						{
							type: "reply",
							reply: {
								id: "CLEAR_CART",
								title: "Clear Cart",
							},
						},
					],
				},
			},
		},
		env
	);
}

/*
|--------------------------------------------------------------------------
| Clear active cart
|--------------------------------------------------------------------------
*/

async function clearCart(
	sender: string,
	env: Env
): Promise<void> {
	const cart =
		await getActiveCart(
			sender,
			env
		);

	if (!cart) {
		await sendWhatsAppMessage(
			sender,
			"Your cart is already empty.",
			env
		);

		return;
	}

	const supabase = getAdminClient(env);

	const { error } = await supabase
		.from("cart_items")
		.delete()
		.eq("cart_id", cart.id);

	if (error) {
		console.error(
			"Clear-cart operation failed:",
			error
		);

		throw new Error(
			"Could not clear shopping cart"
		);
	}

	await sendWhatsAppMessage(
		sender,
		[
			"🗑️ Your cart has been cleared.",
			"",
			"Select View Products to start again.",
		].join("\n"),
		env
	);
}

/*
|--------------------------------------------------------------------------
| Order status
|--------------------------------------------------------------------------
*/

function getOrderStatusLabel(
	status: string
): string {
	const labels: Record<string, string> = {
		pending: "Order created",
		payment_pending: "Awaiting payment",
		paid: "Payment received",
		failed: "Payment setup failed",
		cancelled: "Cancelled",
		fulfilled: "Completed",
		PACKED: "Packed and awaiting shipment",
		SHIPPED: "Shipped",
		OUT_FOR_DELIVERY: "Out for delivery",
		DELIVERED: "Delivered successfully",
	};

	return labels[status] ?? status;
}

function getCustomerOrderStatusMessage(status: string): string | null {
	const messages: Record<string, string> = {
		paid: "✅ Payment received.",
		PACKED: "📦 Order packed and awaiting shipment.",
		SHIPPED: "🚚 Order shipped.",
		OUT_FOR_DELIVERY: "🛵 Out for delivery.",
		DELIVERED: "✅ Delivered successfully.",
	};

	return messages[status] ?? null;
}

function buildProductLines(order: Order): string[] {
	const productNames =
		order.order_items && order.order_items.length > 0
			? order.order_items.map((item) => item.product_name)
			: order.product_name
				? [order.product_name]
				: [];

	if (productNames.length === 0) {
		return [`Product: ${order.product_name}`];
	}

	if (productNames.length === 1) {
		return [`Product: ${productNames[0]}`];
	}

	return ["Product:", ...productNames.map((name) => `- ${name}`)];
}

function createOrderStatusMessage(
	order: Order
): string {
	const messageLines = [
		"📦 Order Status",
		"",
		`Order: #${order.id}`,
		...buildProductLines(order),
		`Quantity: ${order.quantity}`,
		`Amount: ₹${order.total_amount}`,
		`Status: ${getOrderStatusLabel(order.status)}`,
	];

	if (
		order.status === "payment_pending" &&
		order.razorpay_payment_link_url
	) {
		messageLines.push(
			"",
			"Complete your payment:",
			order.razorpay_payment_link_url
		);
	}

	if (order.status === "paid") {
		messageLines.push(
			"",
			"✅ Your payment has been received."
		);
	}

	return messageLines.join("\n");
}

/*
|--------------------------------------------------------------------------
| Track latest order
|--------------------------------------------------------------------------
*/

async function processLatestOrder(
	sender: string,
	env: Env
): Promise<void> {
	const supabase = getAdminClient(env);

	const { data, error } = await supabase
		.from("orders")
		.select(
			"id, customer_phone, product_id, product_name, quantity, unit_price, total_amount, status, razorpay_payment_link_id, razorpay_payment_link_url, razorpay_payment_id, created_at, updated_at, paid_at, order_items(product_name, quantity)"
		)
		.eq("customer_phone", sender)
		.order("created_at", {
			ascending: false,
		})
		.limit(1)
		.maybeSingle();

	if (error) {
		console.error(
			"Latest-order lookup failed:",
			error
		);

		throw new Error(
			"Could not look up latest order"
		);
	}

	if (!data) {
		await sendWhatsAppMessage(
			sender,
			"No active orders found.",
			env
		);

		return;
	}

	const order =
		data as unknown as Order;
	const status = await getOrderStatus(order.id, env);
	const timeline = await getOrderTimeline(order.id, env);
	const lifecycleMessage = getCustomerOrderStatusMessage(status);
	const statusMessage = lifecycleMessage
		? [lifecycleMessage, `Status: ${getOrderStatusLabel(status)}`].join("\n")
		: createOrderStatusMessage({ ...order, status });

	console.log("Order tracking timeline loaded:", {
		orderId: order.id,
		status,
		timelineEntries: timeline.length,
	});

	await sendWhatsAppMessage(
		sender,
		statusMessage,
		env
	);
}

/*
|--------------------------------------------------------------------------
| Order selection list (TRACK_ORDER)
|--------------------------------------------------------------------------
*/

async function sendOrderSelectionList(
	sender: string,
	env: Env
): Promise<void> {
	const supabase = getAdminClient(env);

	const { data, error } = await supabase
		.from("orders")
		.select(
			"id, customer_phone, product_id, product_name, quantity, unit_price, total_amount, status, razorpay_payment_link_id, razorpay_payment_link_url, razorpay_payment_id, created_at, updated_at, paid_at, order_items(product_name, quantity)"
		)
		.eq("customer_phone", sender)
		.order("created_at", { ascending: false })
		.limit(10);

	if (error) {
		console.error("Order list lookup failed:", error);
		throw new Error("Could not look up orders");
	}

	const orders = (data ?? []) as unknown as Order[];

	if (orders.length === 0) {
		await sendWhatsAppMessage(
			sender,
			"No orders were found for your account.",
			env
		);
		return;
	}

	const rows = orders.map((order) => {
		const productNames =
			order.order_items && order.order_items.length > 0
				? order.order_items.map((item) => item.product_name)
				: order.product_name
					? [order.product_name]
					: [];
		const productSummary = productNames.length > 0 ? productNames.join(", ") : "Order";
		const orderDate = new Date(order.created_at).toLocaleDateString("en-IN", {
			day: "numeric",
			month: "short",
			year: "numeric",
		});

		return {
			id: `TRACK_ORDER_${order.id}`,
			title: `Order #${order.id}`.slice(0, 24),
			description: `${productSummary} • ${orderDate}`.slice(0, 72),
		};
	});

	await sendWhatsAppPayload(
		{
			messaging_product: "whatsapp",
			recipient_type: "individual",
			to: sender,
			type: "interactive",
			interactive: {
				type: "list",
				body: {
					text: "Select an order to track",
				},
				action: {
					button: "View Orders",
					sections: [
						{
							title: "Your Orders",
							rows,
						},
					],
				},
			},
		},
		env
	);

	console.log("Interactive order list sent", {
		sender,
		orderCount: orders.length,
	});
}

/*
|--------------------------------------------------------------------------
| Track a specific order
|--------------------------------------------------------------------------
*/

async function processTrackOrderById(
	sender: string,
	orderId: number,
	env: Env
): Promise<void> {
	if (
		!Number.isInteger(orderId) ||
		orderId <= 0
	) {
		await sendWhatsAppMessage(
			sender,
			[
				"That order number is invalid.",
				"",
				"Example: track 5",
			].join("\n"),
			env
		);

		return;
	}

	const supabase = getAdminClient(env);

	const { data, error } = await supabase
		.from("orders")
		.select(
			"id, customer_phone, product_id, product_name, quantity, unit_price, total_amount, status, razorpay_payment_link_id, razorpay_payment_link_url, razorpay_payment_id, created_at, updated_at, paid_at, order_items(product_name, quantity)"
		)
		.eq("id", orderId)
		.eq("customer_phone", sender)
		.maybeSingle();

	if (error) {
		console.error(
			"Order-ID lookup failed:",
			error
		);

		throw new Error(
			"Could not look up order"
		);
	}

	if (!data) {
		await sendWhatsAppMessage(
			sender,
			"No active orders found.",
			env
		);

		return;
	}

	const order =
		data as unknown as Order;
	const status = await getOrderStatus(order.id, env);
	const timeline = await getOrderTimeline(order.id, env);
	const lifecycleMessage = getCustomerOrderStatusMessage(status);
	const statusMessage = lifecycleMessage
		? [lifecycleMessage, `Status: ${getOrderStatusLabel(status)}`].join("\n")
		: createOrderStatusMessage({ ...order, status });

	console.log("Order tracking timeline loaded:", {
		orderId: order.id,
		status,
		timelineEntries: timeline.length,
	});

	await sendWhatsAppMessage(
		sender,
		statusMessage,
		env
	);
}

type SupportIssueType =
	| "REFUND"
	| "DAMAGED_PRODUCT"
	| "REPLACEMENT_REQUEST"
	| "REFUND_REQUEST"
	| "WRONG_ITEM"
	| "PAYMENT_ISSUE"
	| "HUMAN_AGENT"
	| "GENERAL_SUPPORT";

function isDamagedProductIntent(message: string): boolean {
	const hasDamageTerm = /\b(broke|broken|damaged)\b/.test(message);
	const hasProductContext = /\b(product|item|order|watch|shirt|shoe|shoes|bag)\b/.test(message);
	const hasReceivedProductContext = /\breceived\b/.test(message) && /\b(product|item)\b/.test(message);

	return hasDamageTerm && (hasProductContext || hasReceivedProductContext);
}

function isReplacementRequest(message: string): boolean {
	return /\b(replace|replacement)\b/.test(message) && /\b(item|product|order|it|this|that)\b/.test(message)
		|| /^\s*(need|want)\s+replacement\b/.test(message);
}

function isRefundRequest(message: string): boolean {
	return /\b(refund|refund\s+my\s+money)\b/.test(message);
}

async function getLatestCustomerOrder(sender: string, env: Env): Promise<Order | null> {
	const supabase = getAdminClient(env);
	const { data, error } = await supabase
		.from("orders")
		.select("id, customer_id, customer_phone, product_id, product_name, quantity, unit_price, total_amount, status, razorpay_payment_link_id, razorpay_payment_link_url, razorpay_payment_id, created_at, updated_at, paid_at")
		.eq("customer_phone", sender)
		.order("created_at", { ascending: false })
		.limit(1)
		.maybeSingle();

	if (error) {
		throw new Error(`Latest order lookup failed: ${error.message}`);
	}

	return (data as Order | null) ?? null;
}

async function sendDamagedProductActionButtons(
	to: string,
	env: Env
): Promise<void> {
	await sendWhatsAppPayload(
		{
			messaging_product: "whatsapp",
			recipient_type: "individual",
			to,
			type: "interactive",
			interactive: {
				type: "button",
				header: {
					type: "text",
						text: "Support Ticket Created",
				},
				body: {
					text: [
							"Would you like to connect to a support agent?",
						"",
							"Choose an option below.",
					].join("\n"),
				},
				footer: {
					text: "We will proceed with the next step.",
				},
				action: {
					buttons: [
						{
							type: "reply",
							reply: {
								id: "TALK_AGENT",
								title: "Talk to Agent",
							},
						},
						{
							type: "reply",
							reply: {
								id: "NO_THANKS",
								title: "No Thanks",
							},
						},
					],
				},
			},
		},
		env
	);
}

async function sendPostImageSupportActions(
	to: string,
	ticketNumber: string,
	env: Env
): Promise<void> {
	await sendWhatsAppPayload(
		{
			messaging_product: "whatsapp",
			recipient_type: "individual",
			to,
			type: "interactive",
			interactive: {
				type: "button",
				body: {
					text: [
						"✅ Evidence received",
						"",
						`Ticket: ${ticketNumber}`,
						"",
						"What would you like to do next?",
					].join("\n"),
				},
				action: {
					buttons: [
						{ type: "reply", reply: { id: "CONNECT_AGENT", title: "Connect Agent" } },
						{ type: "reply", reply: { id: "TRACK_TICKET", title: "Track Ticket" } },
						{ type: "reply", reply: { id: "CANCEL_REQUEST", title: "Cancel Request" } },
					],
				},
			},
		},
		env
	);
}

async function sendDamagedProductResolutionCheck(
	to: string,
	troubleshootingMessage: string,
	env: Env
): Promise<void> {
	await sendWhatsAppPayload(
		{
			messaging_product: "whatsapp",
			recipient_type: "individual",
			to,
			type: "interactive",
			interactive: {
				type: "button",
				body: {
					text: troubleshootingMessage,
				},
				action: {
					buttons: [
						{ type: "reply", reply: { id: "ISSUE_RESOLVED", title: "Issue Resolved" } },
						{ type: "reply", reply: { id: "CONNECT_AGENT", title: "Connect Agent" } },
					],
				},
			},
		},
		env
	);
}

type SupportIntent = "CONTINUE_SUPPORT" | "CLOSE_SUPPORT_TICKET";

async function classifySupportIntent(
	message: string,
	env: Env
): Promise<SupportIntent> {
	const response = await fetch("https://api.openai.com/v1/chat/completions", {
		method: "POST",
		headers: {
			Authorization: `Bearer ${env.OPENAI_API_KEY}`,
			"Content-Type": "application/json",
		},
		body: JSON.stringify({
			model: env.OPENAI_CHAT_MODEL || "gpt-4o-mini",
			temperature: 0,
			max_tokens: 10,
			messages: [
				{
					role: "system",
					content: [
						"You are a support-ticket intent classifier.",
						"Determine whether the customer wants:",
						"CONTINUE_SUPPORT or CLOSE_SUPPORT_TICKET",
						"Return ONLY the intent.",
					].join("\n"),
				},
				{ role: "user", content: message },
			],
		}),
	});

	if (!response.ok) {
		const errorBody = await response.text();
		throw new Error(`Support intent classification failed (${response.status}): ${errorBody}`);
	}

	const result = await response.json() as {
		choices?: Array<{ message?: { content?: string } }>;
	};
	const intent = result.choices?.[0]?.message?.content?.trim().toUpperCase();

	return intent === "CLOSE_SUPPORT_TICKET"
		? "CLOSE_SUPPORT_TICKET"
		: "CONTINUE_SUPPORT";
}

async function closeWaitingAgentTicket(
	sender: string,
	ticket: SupportTicketRecord,
	env: Env,
	customClosingMessage?: string
): Promise<void> {
	const closedTicket = await updateSupportTicketStatus(ticket.id, "CLOSED", env);
	await addSupportMessage(
		ticket.id,
		"AGENT",
		"Customer closed the conversation.",
		env,
		"system"
	);

	const agentSession = await getActiveOrWaitingAgentSessionForTicket(ticket.id, env);
	if (agentSession) {
		await closeSupportAgentSession(agentSession.id, env);
	}

	console.log("[SUPPORT INTENT CLOSE]", {
		ticketId: closedTicket.id,
		ticketNumber: closedTicket.ticket_number,
	});
	console.log("[SUPPORT TICKET CLOSED]", {
		ticketId: closedTicket.id,
		ticketNumber: closedTicket.ticket_number,
	});
	await sendWhatsAppMessage(
		sender,
		customClosingMessage ?? [
			"✅ Your support ticket has been closed.",
			"",
			`Ticket Number: ${closedTicket.ticket_number}`,
			"",
			"If you need help again, simply send another message.",
		].join("\n"),
		env
	);
}

async function processWaitingAgentCustomerMessage(
	sender: string,
	message: string,
	env: Env
): Promise<boolean> {
	const ticket = await getLatestCustomerSupportTicket(sender, env);
	if (!ticket) {
		return false;
	}

	const agentSession = await getActiveOrWaitingAgentSessionForTicket(ticket.id, env);
	if (!agentSession) {
		return false;
	}

	if (agentSession.status === "WAITING_FOR_AGENT") {
		const intent = await classifySupportIntent(message, env);
		if (intent === "CLOSE_SUPPORT_TICKET") {
			await closeWaitingAgentTicket(sender, ticket, env);
			return true;
		}
	}

	await addSupportMessage(ticket.id, "CUSTOMER", message, env, sender);
	console.log("[AGENT CUSTOMER MESSAGE]", {
		sessionId: agentSession.id,
		ticketId: ticket.id,
		messageLength: message.length,
	});
	return true;
}

function isNaturalAgentRequest(message: string): boolean {
	return /\b(agent|customer\s+agent|human|live\s+support|talk\s+to\s+agent|support\s+executive|representative|customer\s+care)\b/.test(message);
}

/*
|--------------------------------------------------------------------------
| Direct human-agent WhatsApp handoff (CTA link, not the bot-mediated
| agent-session flow — see startAgentHandoff below, kept intact/unused
| by this path per the feature spec).
|--------------------------------------------------------------------------
*/

// Single place for phone-number formatting for this feature. Strips
// everything but digits and applies a sane international-length bound —
// intentionally not full E.164 validation (country-specific rules vary),
// just enough to reject obviously-broken configuration before it becomes a
// broken customer-facing link.
export function normalizeWhatsAppNumber(value: string | undefined | null): string | null {
	if (!value) {
		return null;
	}
	const digitsOnly = value.replace(/\D/g, "");
	if (digitsOnly.length < 8 || digitsOnly.length > 15) {
		return null;
	}
	return digitsOnly;
}

export function buildAgentWhatsAppUrl(
	normalizedSupportNumber: string,
	prefilledMessage: string
): string {
	return `https://wa.me/${normalizedSupportNumber}?text=${encodeURIComponent(prefilledMessage)}`;
}

function formatIssueTypeLabel(issueType: string): string {
	return issueType
		.toLowerCase()
		.split("_")
		.filter(Boolean)
		.map((word) => word[0].toUpperCase() + word.slice(1))
		.join(" ");
}

export function buildAgentHandoffMessage(
	ticket?: Pick<SupportTicketRecord, "ticket_number" | "issue_type"> | null
): string {
	const lines = ["Hi, I need help with my support request."];
	if (ticket) {
		lines.push("", `Ticket: #${ticket.ticket_number}`, `Issue: ${formatIssueTypeLabel(ticket.issue_type)}`);
	}
	return lines.join("\n");
}

async function sendConnectAgentCta(sender: string, env: Env): Promise<void> {
	const normalizedNumber = normalizeWhatsAppNumber(env.SUPPORT_WHATSAPP_NUMBER);

	if (!normalizedNumber) {
		console.error("[CONNECT AGENT CTA] SUPPORT_WHATSAPP_NUMBER is missing or invalid; cannot build direct-chat link", {
			configured: Boolean(env.SUPPORT_WHATSAPP_NUMBER),
		});
		await sendWhatsAppMessage(
			sender,
			[
				"Sorry, our direct support chat isn't available right now.",
				"",
				"Please try again shortly, or use Track Ticket to check your request.",
			].join("\n"),
			env
		);
		return;
	}

	let ticket: SupportTicketRecord | null = null;
	try {
		ticket = await getLatestCustomerSupportTicket(sender, env);
	} catch (error) {
		console.error("[CONNECT AGENT CTA] Ticket lookup failed; continuing without ticket context", error);
	}

	const prefilledMessage = buildAgentHandoffMessage(ticket);
	const whatsappUrl = buildAgentWhatsAppUrl(normalizedNumber, prefilledMessage);

	await sendWhatsAppPayload(
		{
			messaging_product: "whatsapp",
			recipient_type: "individual",
			to: sender,
			type: "interactive",
			interactive: {
				type: "cta_url",
				body: {
					text: "Need more help? Chat directly with our support team.",
				},
				action: {
					name: "cta_url",
					parameters: {
						display_text: "Connect to Agent",
						url: whatsappUrl,
					},
				},
			},
		},
		env
	);

	console.log("[CONNECT AGENT CTA] Direct WhatsApp handoff link sent", {
		sender,
		hasTicket: Boolean(ticket),
		ticketId: ticket?.id ?? null,
	});
}

async function startAgentHandoff(
	sender: string,
	env: Env
): Promise<boolean> {
	const ticket = await getLatestCustomerSupportTicket(sender, env);
	if (!ticket || ticket.status !== "OPEN") {
		return false;
	}

	await createSupportAgentSession(ticket.id, sender, env);
	const waitingTicket = await updateSupportTicketStatus(ticket.id, "WAITING_AGENT", env);
	console.log("[AGENT HANDOFF]", {
		ticketId: waitingTicket.id,
		ticketNumber: waitingTicket.ticket_number,
		phoneNumber: sender,
	});
	console.log("[AGENT SESSION CREATED]", {
		ticketId: waitingTicket.id,
		phoneNumber: sender,
	});
	await sendWhatsAppPayload(
		{
			messaging_product: "whatsapp",
			recipient_type: "individual",
			to: sender,
			type: "interactive",
			interactive: {
				type: "button",
				body: {
					text: [
						"✅ Agent request received",
						"",
						`Ticket: ${waitingTicket.ticket_number}`,
						"",
						"You have been added to the support queue.",
						"",
						"A support agent will join shortly.",
					].join("\n"),
				},
				action: {
					buttons: [
						{ type: "reply", reply: { id: "END_CHAT", title: "End Chat" } },
					],
				},
			},
		},
		env
	);
	return true;
}

async function startDamagedProductSupportSession(
	sender: string,
	message: string,
	env: Env
): Promise<void> {
	const latestOrder = await getLatestCustomerOrder(sender, env);
	const productName = latestOrder?.product_name ?? "your recent order item";
	const existingSession = await getActiveSupportSession(sender, env);

	if (existingSession && existingSession.issue_type === "DAMAGED_PRODUCT") {
		await handleDamagedProductSupportConversation(sender, message, env, existingSession);
		return;
	}

	const session = await createSupportSession(
		{
			customerPhone: sender,
			orderId: latestOrder?.id ?? null,
			issueType: "DAMAGED_PRODUCT",
			currentStep: "ASK_PRODUCT",
			productName: latestOrder?.product_name ?? null,
			collectedData: {
				issue_type: "DAMAGED_PRODUCT",
				product_name: latestOrder?.product_name ?? null,
				order_id: latestOrder?.id ?? null,
			},
		},
		env
	);

	await upsertConversationState(
		sender,
		"CUSTOMER_CARE",
		env,
		{ source: "DAMAGED_PRODUCT", session_id: session.id },
		message
	);

	await sendWhatsAppMessage(
		sender,
		[
			"I can help with a damaged product.",
			"",
			`Is the damaged item the product from your recent order: ${productName}?`,
			"",
			"Reply YES or NO. If it is a different product, tell me the product name.",
		].join("\n"),
		env
	);
}

async function createImmediateSupportTicket(
	sender: string,
	message: string,
	issueType: SupportIssueType,
	env: Env
): Promise<void> {
	const latestOrder = await getLatestCustomerOrder(sender, env);
	const existingTicket = await getLatestOpenCustomerSupportTicket(sender, env);
	const session = await createSupportSession(
		{
			customerPhone: sender,
			orderId: latestOrder?.id ?? null,
			issueType,
			currentStep: "ASK_IMAGE",
			productName: latestOrder?.product_name ?? null,
			issueDescription: message,
			preferredResolution: issueType === "REFUND_REQUEST" ? "refund" : issueType === "REPLACEMENT_REQUEST" ? "replacement" : null,
			collectedData: {
				issue_type: issueType,
				issue_description: message,
				product_name: latestOrder?.product_name ?? null,
			},
		},
		env
	);

	let ticket: SupportTicketRecord;
	if (existingTicket) {
		ticket = existingTicket;
		console.log("[EXISTING OPEN TICKET REUSED]", {
			ticketId: ticket.id,
			ticketNumber: ticket.ticket_number,
			phoneNumber: sender,
		});
	} else {
		ticket = await createSupportTicket(
			{
				customerId: latestOrder?.customer_id ?? null,
				customerPhone: sender,
				orderId: latestOrder?.id ?? null,
				issueType,
				issueDescription: message,
				productName: latestOrder?.product_name ?? null,
				preferredResolution: issueType === "REFUND_REQUEST" ? "refund" : issueType === "REPLACEMENT_REQUEST" ? "replacement" : null,
				priority: "NORMAL",
			},
			env
		);
		console.log("[SUPPORT TICKET CREATED]", { ticketId: ticket.id, ticketNumber: ticket.ticket_number, issueType });
	}

	await updateSupportSession(
		session.id,
		{ status: "COLLECTING_INFO" },
		env
	);
	console.log("[SUPPORT ROUTE]", { sender, issueType, sessionId: session.id });

	await sendWhatsAppMessage(
		sender,
		[
			"✅ Support request received.",
			"",
			`Ticket Number: ${ticket.ticket_number}`,
			"",
			"Please upload an image of the product so our support team can review it.",
		].join("\n"),
		env
	);
}

async function handleDamagedProductSupportConversation(
	sender: string,
	incomingText: string,
	env: Env,
	session: Awaited<ReturnType<typeof getActiveSupportSession>>
): Promise<boolean> {
	if (!session || session.issue_type !== "DAMAGED_PRODUCT") {
		return false;
	}

	const text = incomingText.trim();
	const normalized = normalizeSupportSessionAnswer(text);
	const existingData = (session.collected_data ?? {}) as Record<string, unknown>;

	if (session.current_step === "ASK_PRODUCT") {
		if (!text) {
			await sendWhatsAppMessage(sender, "Please reply YES or NO, or tell me the damaged product name.", env);
			return true;
		}

		if (isAffirmativeAnswer(text)) {
			const productName = session.product_name ?? "your item";
			await updateSupportSession(
				session.id,
				{
					status: "COLLECTING_INFO",
					product_name: productName,
					current_step: "ASK_ISSUE",
					collected_data: {
						...existingData,
						product_confirmed: true,
						product_name: productName,
					},
				},
				env
			);
			await sendWhatsAppMessage(sender, `Thanks. Please describe the damage to ${productName}.`, env);
			return true;
		}

		if (isNegativeAnswer(text)) {
			await updateSupportSession(
				session.id,
				{
					status: "COLLECTING_INFO",
					current_step: "ASK_PRODUCT",
					collected_data: {
						...existingData,
						product_confirmed: false,
					},
				},
				env
			);
			await sendWhatsAppMessage(sender, "Please tell me the damaged product name so I can continue.", env);
			return true;
		}

		const productName = text;
		await updateSupportSession(
			session.id,
			{
				status: "COLLECTING_INFO",
				product_name: productName,
				current_step: "ASK_ISSUE",
				collected_data: {
					...existingData,
					product_confirmed: false,
					product_name: productName,
				},
			},
			env
		);
		await sendWhatsAppMessage(sender, `Thanks. Please describe the damage to ${productName}.`, env);
		return true;
	}

	if (session.current_step === "ASK_ISSUE") {
		if (!text) {
			await sendWhatsAppMessage(sender, "Please tell us how the product was damaged.", env);
			return true;
		}

		await updateSupportSession(
			session.id,
			{
				status: "COLLECTING_INFO",
				issue_description: text,
				current_step: "ASK_RESOLUTION",
				summary_text: text,
				collected_data: {
					...existingData,
					issue_description: text,
					summary_text: text,
				},
			},
			env
		);
		await sendWhatsAppMessage(sender, "What resolution would you prefer: refund or replacement?", env);
		return true;
	}

	if (session.current_step === "ASK_RESOLUTION") {
		const resolution = normalized;
		if (!(/refund|replacement/.test(resolution))) {
			await sendWhatsAppMessage(sender, "Please reply with either refund or replacement.", env);
			return true;
		}

		const preferredResolution = resolution.includes("refund") ? "refund" : "replacement";
		await updateSupportSession(
			session.id,
			{
				status: "COLLECTING_INFO",
				preferred_resolution: preferredResolution,
				current_step: "ASK_IMAGE",
				collected_data: {
					...existingData,
					preferred_resolution: preferredResolution,
				},
			},
			env
		);
		await sendWhatsAppMessage(sender, "Please upload a clear image of the damaged product so we can review it.", env);
		return true;
	}

	if (session.current_step === "WAITING_USER_DECISION") {
		await sendDamagedProductActionButtons(sender, env);
		return true;
	}

	return false;
}

function resolveSupportIssueType(message: string): SupportIssueType {
	if (isDamagedProductIntent(message)) {
		return "DAMAGED_PRODUCT";
	}

	if (isReplacementRequest(message)) {
		return "REPLACEMENT_REQUEST";
	}

	if (isRefundRequest(message)) {
		return "REFUND_REQUEST";
	}

	if (/\bwrong\s+(item|product)\b/.test(message)) {
		return "WRONG_ITEM";
	}

	if (/\bpayment\s+(issue|problem)\b/.test(message)) {
		return "PAYMENT_ISSUE";
	}

	if (/\bneed\s+(a\s+)?human\s+agent\b/.test(message) || /\btalk\s+to\s+support\b/.test(message)) {
		return "HUMAN_AGENT";
	}

	return "GENERAL_SUPPORT";
}

function isSupportIntent(message: string): boolean {
	return (
		isDamagedProductIntent(message) ||
		isReplacementRequest(message) ||
		isRefundRequest(message) ||
		/\bwrong\s+(item|product)\b/.test(message) ||
		/\breplacement\b/.test(message) ||
		/\bpayment\s+(issue|problem)\b/.test(message) ||
		/\bneed\s+(a\s+)?human\s+agent\b/.test(message) ||
		/\btalk\s+to\s+support\b/.test(message) ||
		/\bcustomer\s+support\b/.test(message)
	);
}

// Matches a message that is ONLY a greeting (optionally with trailing
// punctuation/"there"), tolerating repeated letters ("hii", "hiii") and
// case. Anchored with ^...$ so a greeting attached to a substantive request
// ("hi, where is my order?") deliberately does NOT match — that message
// must continue through normal intent handling instead of stopping at the
// main menu.
export function isGreetingOnly(message: string): boolean {
	const normalized = message.trim().toLowerCase();
	return /^((h+i+|h+e+y+)(\s+there)?|h+e+l+l+o+|good\s+(morning|afternoon|evening))[\s!.,]*$/.test(normalized);
}

export function isSupportStatusIntent(message: string): boolean {
	return (
		/\btrack\s+ticket\b/.test(message) ||
		/\bticket\s+status\b/.test(message) ||
		/\bmy\s+ticket\b/.test(message) ||
		/\bsupport\s+update\b/.test(message) ||
		/\bcomplaint\s+status\b/.test(message) ||
		/\bcheck\s+my\s+ticket\b/.test(message) ||
		/\bsupport\s+ticket\b/.test(message) ||
		/\brequest\s+status\b/.test(message) ||
		/\bmy\s+complaint\b/.test(message) ||
		/\bupdate\s+on\s+my\s+(complaint|ticket|refund|support|replacement)\b/.test(message)
	);
}

// Narrower than isSupportStatusIntent: matches messages that clearly want to
// append information to an existing ticket, as opposed to checking its
// status. Checked before isSupportStatusIntent so append-phrasing (e.g. "add
// this to my ticket") isn't swallowed by the broader "my ticket" status match.
export function hasExplicitTicketAppendIntent(message: string): boolean {
	return (
		(/\b(add|attach|append|note|here)\b/.test(message) && /\bticket\b/.test(message)) ||
		(/\bmore\s+information\b/.test(message) && /\bticket\b/.test(message)) ||
		/\btkt-[a-z0-9-]+\b/i.test(message)
	);
}

async function processSupportTicketStatusRequest(
	sender: string,
	env: Env
): Promise<void> {
	const ticket = await getLatestCustomerSupportTicket(sender, env);
	if (!ticket) {
		console.log('[SUPPORT TICKET LOOKUP] No active ticket found', { phoneNumber: sender });
		await sendWhatsAppMessage(
			sender,
			"No support tickets were found for your account.",
			env
		);
		return;
	}

	console.log('[SUPPORT TICKET LOOKUP] Sending ticket status', {
		phoneNumber: sender,
		ticketNumber: ticket.ticket_number,
		status: ticket.status,
	});

	await sendWhatsAppMessage(
		sender,
		[
			"🎫 Support Ticket Status",
			"",
			`Ticket Number: ${ticket.ticket_number}`,
			"",
			`Issue Type: ${ticket.issue_type}`,
			"",
			`Status: ${ticket.status}`,
			`Created: ${new Date(ticket.created_at).toLocaleString("en-IN")}`,
		].join("\n"),
		env
	);
}

async function processSupportRequest(
	sender: string,
	message: string,
	env: Env,
	issueTypeOverride?: SupportIssueType
): Promise<void> {
	const supabase = getAdminClient(env);
	const { data: latestOrder, error: orderError } = await supabase
		.from("orders")
		.select("id, customer_id")
		.eq("customer_phone", sender)
		.order("created_at", { ascending: false })
		.limit(1)
		.maybeSingle();

	if (orderError) {
		console.error("Support latest-order lookup failed:", orderError);
		throw new Error("Could not look up latest order for support ticket");
	}

	const issueType = issueTypeOverride ?? resolveSupportIssueType(message);
	const existingTicket = await getLatestOpenCustomerSupportTicket(sender, env);

	let ticket: SupportTicketRecord;
	if (existingTicket) {
		ticket = existingTicket;
		console.log("[EXISTING OPEN TICKET REUSED]", {
			ticketId: ticket.id,
			ticketNumber: ticket.ticket_number,
			phoneNumber: sender,
		});
	} else {
		ticket = await createSupportTicket(
			{
				customerId: latestOrder?.customer_id ?? null,
				customerPhone: sender,
				orderId: latestOrder?.id ?? null,
				issueType,
			},
			env
		);
		console.log("[SUPPORT TICKET CREATED]", { ticketId: ticket.id, ticketNumber: ticket.ticket_number, issueType });
	}

	await sendWhatsAppMessage(
		sender,
		[
			"🎫 Ticket Created",
			"",
			`Ticket Number: ${ticket.ticket_number}`,
			"",
			`Issue Type: ${ticket.issue_type}`,
			"",
			"Status: OPEN",
			"",
			"Our support team will contact you shortly.",
		].join("\n"),
		env
	);
}

async function processSupportImageMessage(
	sender: string,
	image: { id?: string; url?: string },
	env: Env
): Promise<boolean> {
	const ticket = await getLatestCustomerSupportTicket(sender, env);
	if (!ticket) {
		console.log("[SUPPORT IMAGE] No active ticket found", { phoneNumber: sender });
		return false;
	}

	if (!image.id) {
		console.error("[SUPPORT IMAGE] Image media id missing", { phoneNumber: sender });
		return false;
	}

	const { error } = await getAdminClient(env)
		.from("ticket_messages")
		.insert({
			ticket_id: ticket.id,
			sender_type: "CUSTOMER",
			message: null,
			message_type: "IMAGE",
			media_id: image.id,
			image_url: image.url ?? null,
		});

	if (error) {
		throw new Error(`Support image message creation failed: ${error.message}`);
	}

	console.log("[SUPPORT IMAGE] Image attached to ticket", {
		phoneNumber: sender,
		ticketId: ticket.id,
		ticketNumber: ticket.ticket_number,
		mediaId: image.id,
		hasImageUrl: Boolean(image.url),
	});

	const agentSession = await getActiveOrWaitingAgentSessionForTicket(ticket.id, env);
	if (agentSession) {
		console.log("[AGENT CUSTOMER IMAGE]", {
			sessionId: agentSession.id,
			ticketId: ticket.id,
			mediaId: image.id,
		});
		return true;
	}

	await sendPostImageSupportActions(sender, ticket.ticket_number, env);
	console.log("[SUPPORT POST IMAGE ACTIONS]", {
		ticketId: ticket.id,
		ticketNumber: ticket.ticket_number,
		phoneNumber: sender,
	});

	return true;
}

async function processSupportTextMessage(
	sender: string,
	message: string,
	env: Env
): Promise<boolean> {
	const ticket = await getLatestCustomerSupportTicket(sender, env);
	if (!ticket) {
		return false;
	}

	const { error } = await getAdminClient(env)
		.from("ticket_messages")
		.insert({
			ticket_id: ticket.id,
			sender_type: "CUSTOMER",
			message,
			message_type: "TEXT",
		});

	if (error) {
		throw new Error(`Support text message creation failed: ${error.message}`);
	}

	console.log("[SUPPORT TEXT] Message added to ticket", {
		phoneNumber: sender,
		ticketId: ticket.id,
		ticketNumber: ticket.ticket_number,
		messageLength: message.length,
	});

	await sendWhatsAppMessage(
		sender,
		[
			"✅ Message added to your support ticket.",
			"",
			`Ticket Number: ${ticket.ticket_number}`,
		].join("\n"),
		env
	);

	return true;
}

/*
|--------------------------------------------------------------------------
| Razorpay Payment Link
|--------------------------------------------------------------------------
*/

async function createRazorpayPaymentLink(
	order: Order,
	env: Env
): Promise<RazorpayPaymentLink> {
	const authorization = btoa(
		`${env.RAZORPAY_KEY_ID}:${env.RAZORPAY_KEY_SECRET}`
	);

	const amountInPaise =
		order.total_amount * 100;

	const response = await fetch(
		"https://api.razorpay.com/v1/payment_links",
		{
			method: "POST",
			headers: {
				Authorization:
					`Basic ${authorization}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({
				amount: amountInPaise,
				currency: "INR",
				accept_partial: false,
				reference_id:
					`ORDER_${order.id}_${Date.now()}`,
				description:
					`Payment for ${order.product_name}`.slice(
						0,
						255
					),
				customer: {
					contact:
						`+${order.customer_phone}`,
				},
				notify: {
					sms: false,
					email: false,
				},
				reminder_enable: false,
				notes: {
					order_id:
						String(order.id),
					customer_phone:
						order.customer_phone,
				},
			}),
		}
	);

	const responseText =
		await response.text();

	if (!response.ok) {
		console.error(
			"Razorpay Payment Link error:",
			response.status,
			responseText
		);

		throw new Error(
			"Could not create Razorpay Payment Link"
		);
	}

	const paymentLink =
		JSON.parse(responseText);

	return {
		id: String(paymentLink.id),
		short_url:
			String(paymentLink.short_url),
	};
}

/*
|--------------------------------------------------------------------------
| Validate cart before checkout
|--------------------------------------------------------------------------
*/

async function validateCartItems(
	items: CartItem[],
	env: Env
): Promise<{
	validatedItems: CartItem[];
	totalAmount: number;
}> {
	const supabase = getAdminClient(env);
	const validatedItems: CartItem[] = [];

	for (const item of items) {
		const {
			data: productData,
			error: productError,
		} = await supabase
			.from("products")
			.select("id, name, price, stock")
			.eq("id", item.product_id)
			.maybeSingle();

		if (productError || !productData) {
			throw new Error(
				`${item.product_name} is no longer available`
			);
		}

		const product =
			productData as unknown as Product;

		if (product.stock < item.quantity) {
			throw new Error(
				`Only ${product.stock} unit(s) of ${product.name} are available`
			);
		}

		validatedItems.push({
			...item,
			product_name: product.name,
			unit_price: product.price,
		});
	}

	return {
		validatedItems,
		totalAmount:
			calculateCartTotal(
				validatedItems
			),
	};
}

/*
|--------------------------------------------------------------------------
| Checkout cart
|--------------------------------------------------------------------------
*/

async function checkoutCart(
	sender: string,
	messageId: string,
	env: Env
): Promise<void> {
	const supabase = getAdminClient(env);

	const { data: existingOrderData } =
		await supabase
			.from("orders")
			.select(
				"id, razorpay_payment_link_url"
			)
			.eq("meta_message_id", messageId)
			.maybeSingle();

	if (existingOrderData) {
		const existingOrder =
			existingOrderData as unknown as ExistingOrder;

		const lines = [
			"This checkout has already been processed.",
			"",
			`Order: #${existingOrder.id}`,
		];

		if (
			existingOrder
				.razorpay_payment_link_url
		) {
			lines.push(
				"",
				"Payment link:",
				existingOrder
					.razorpay_payment_link_url
			);
		}

		await sendWhatsAppMessage(
			sender,
			lines.join("\n"),
			env
		);

		return;
	}

	const cart =
		await getActiveCart(
			sender,
			env
		);

	if (!cart) {
		await sendWhatsAppMessage(
			sender,
			[
				"Your cart is empty.",
				"",
				"Select View Products to add products.",
			].join("\n"),
			env
		);

		return;
	}

	const cartItems =
		await getCartItems(
			cart.id,
			env
		);

	if (cartItems.length === 0) {
		await sendWhatsAppMessage(
			sender,
			"Your cart is empty.",
			env
		);

		return;
	}

	let validatedItems: CartItem[];
	let totalAmount: number;

	try {
		const validation =
			await validateCartItems(
				cartItems,
				env
			);

		validatedItems =
			validation.validatedItems;

		totalAmount =
			validation.totalAmount;
	} catch (error) {
		const message =
			error instanceof Error
				? error.message
				: "A cart item is unavailable";

		await sendWhatsAppMessage(
			sender,
			[
				"Your cart could not be checked out.",
				"",
				message,
				"",
				"Please update your cart and try again.",
			].join("\n"),
			env
		);

		return;
	}

	const firstItem =
		validatedItems[0];

	const totalQuantity =
		calculateTotalQuantity(
			validatedItems
		);

	const productDescription =
		createCartDescription(
			validatedItems
		);

	const orderProductName =
		validatedItems.length === 1
			? firstItem.product_name
			: `Cart: ${productDescription}`;

	const {
		data: orderData,
		error: orderError,
	} = await supabase
		.from("orders")
		.insert({
			customer_phone: sender,
			meta_message_id: messageId,

			/*
			 * The existing orders table requires a product ID.
			 * The detailed multi-product data is stored in order_items.
			 */
			product_id: firstItem.product_id,
			product_name:
				orderProductName.slice(
					0,
					255
				),
			quantity: totalQuantity,
			unit_price: totalAmount,
			total_amount: totalAmount,
			status: "pending",
		})
		.select("*")
		.single();

	if (orderError || !orderData) {
		console.error(
			"Cart-order creation failed:",
			orderError
		);

		throw new Error(
			"Could not create order from cart"
		);
	}

	const order =
		orderData as unknown as Order;

	const orderItemRows =
		validatedItems.map((item) => ({
			order_id: order.id,
			product_id: item.product_id,
			product_name: item.product_name,
			unit_price: item.unit_price,
			quantity: item.quantity,
			line_total:
				item.unit_price *
				item.quantity,
		}));

	const { error: itemInsertError } =
		await supabase
			.from("order_items")
			.insert(orderItemRows);

	if (itemInsertError) {
		console.error(
			"Order-items creation failed:",
			itemInsertError
		);

		await supabase
			.from("orders")
			.update({
				status: "failed",
				updated_at:
					new Date().toISOString(),
			})
			.eq("id", order.id);

		throw new Error(
			"Could not save order items"
		);
	}

	try {
		const paymentLink =
			await createRazorpayPaymentLink(
				order,
				env
			);

		const { error: updateError } =
			await supabase
				.from("orders")
				.update({
					status:
						"payment_pending",
					razorpay_payment_link_id:
						paymentLink.id,
					razorpay_payment_link_url:
						paymentLink.short_url,
					updated_at:
						new Date().toISOString(),
				})
				.eq("id", order.id);

		if (updateError) {
			throw new Error(
				"Could not save Payment Link"
			);
		}

		const { error: cartUpdateError } =
			await supabase
				.from("carts")
				.update({
					status: "checked_out",
					updated_at:
						new Date().toISOString(),
				})
				.eq("id", cart.id);

		if (cartUpdateError) {
			console.error(
				"Cart status update failed:",
				cartUpdateError
			);
		}

		const itemLines: string[] = [];

		for (const item of validatedItems) {
			itemLines.push(
				`${item.product_name}: ${item.quantity} × ₹${item.unit_price}`
			);
		}

		await sendWhatsAppMessage(
			sender,
			[
				"🧾 Order created",
				"",
				`Order: #${order.id}`,
				"",
				...itemLines,
				"",
				`Total: ₹${totalAmount}`,
				"",
				"Complete your payment:",
				paymentLink.short_url,
				"",
				"Use Track Order to view the latest status.",
			].join("\n"),
			env
		);
	} catch (error) {
		console.error(
			"Cart Payment Link creation failed:",
			error
		);

		await supabase
			.from("orders")
			.update({
				status: "failed",
				updated_at:
					new Date().toISOString(),
			})
			.eq("id", order.id);

		await sendWhatsAppMessage(
			sender,
			[
				`Order #${order.id} was created,`,
				"but the payment link could not be generated.",
				"",
				"Please try again later.",
			].join("\n"),
			env
		);
	}
}

/*
|--------------------------------------------------------------------------
| Legacy typed buy command
|--------------------------------------------------------------------------
|
| This keeps "buy 1" working.
|
|--------------------------------------------------------------------------
*/

async function processBuyCommand(
	sender: string,
	messageId: string,
	productId: number,
	env: Env
): Promise<void> {
	await addProductToCart(
		sender,
		productId,
		env
	);

	console.log(
		"Legacy buy command added product to cart:",
		{
			sender,
			messageId,
			productId,
		}
	);
}

/*
|--------------------------------------------------------------------------
| Razorpay signature verification
|--------------------------------------------------------------------------
*/

function bytesToHex(
	bytes: ArrayBuffer
): string {
	return Array.from(
		new Uint8Array(bytes)
	)
		.map((byte) =>
			byte
				.toString(16)
				.padStart(2, "0")
		)
		.join("");
}

function safeCompare(
	expected: string,
	actual: string
): boolean {
	if (expected.length !== actual.length) {
		return false;
	}

	let difference = 0;

	for (
		let index = 0;
		index < expected.length;
		index += 1
	) {
		difference |=
			expected.charCodeAt(index) ^
			actual.charCodeAt(index);
	}

	return difference === 0;
}

async function verifyRazorpaySignature(
	rawBody: string,
	signature: string,
	secret: string
): Promise<boolean> {
	try {
		const key =
			await crypto.subtle.importKey(
				"raw",
				new TextEncoder().encode(secret),
				{
					name: "HMAC",
					hash: "SHA-256",
				},
				false,
				["sign"]
			);

		const generatedSignature =
			await crypto.subtle.sign(
				"HMAC",
				key,
				new TextEncoder().encode(
					rawBody
				)
			);

		const expectedSignature =
			bytesToHex(
				generatedSignature
			);

		return safeCompare(
			expectedSignature.toLowerCase(),
			signature.toLowerCase()
		);
	} catch (error) {
		console.error(
			"Razorpay signature error:",
			error
		);

		return false;
	}
}

/*
|--------------------------------------------------------------------------
| Razorpay webhook
|--------------------------------------------------------------------------
*/

async function processRazorpayWebhook(
	request: Request,
	env: Env
): Promise<Response> {
	const rawBody =
		await request.text();

	const signature =
		request.headers.get(
			"x-razorpay-signature"
		);

	if (!signature) {
		return new Response(
			"Missing signature",
			{ status: 401 }
		);
	}

	const signatureIsValid =
		await verifyRazorpaySignature(
			rawBody,
			signature,
			env.RAZORPAY_WEBHOOK_SECRET
		);

	if (!signatureIsValid) {
		console.error(
			"Invalid Razorpay webhook signature"
		);

		return new Response(
			"Invalid signature",
			{ status: 401 }
		);
	}

	const webhookEvent =
		JSON.parse(rawBody);

	console.log(
		"Verified Razorpay webhook:",
		webhookEvent.event
	);

	const eventId =
		request.headers.get(
			"x-razorpay-event-id"
		) ??
		`${webhookEvent.event}_${webhookEvent.created_at}`;

	const supabase = getAdminClient(env);

	const { data: existingEvent } =
		await supabase
			.from(
				"processed_webhook_events"
			)
			.select("id")
			.eq("event_id", eventId)
			.maybeSingle();

	if (existingEvent) {
		console.log(
			"Duplicate webhook ignored:",
			eventId
		);

		return new Response(
			"Already processed",
			{ status: 200 }
		);
	}

	if (
		webhookEvent.event !==
		"payment_link.paid"
	) {
		console.log(
			"Razorpay event ignored:",
			webhookEvent.event
		);

		return new Response(
			"Event ignored",
			{ status: 200 }
		);
	}

	const paymentLink =
		webhookEvent.payload
			?.payment_link?.entity;

	const payment =
		webhookEvent.payload
			?.payment?.entity;

	if (!paymentLink?.id) {
		return new Response(
			"Payment Link ID missing",
			{ status: 400 }
		);
	}

	const {
		data: orderData,
		error: orderError,
	} = await supabase
		.from("orders")
		.select("*")
		.eq(
			"razorpay_payment_link_id",
			paymentLink.id
		)
		.maybeSingle();

	if (orderError) {
		console.error(
			"Payment order lookup failed:",
			orderError
		);

		return new Response(
			"Database error",
			{ status: 500 }
		);
	}

	if (!orderData) {
		console.error(
			"No order found for Payment Link:",
			paymentLink.id
		);

		return new Response(
			"Order not found",
			{ status: 404 }
		);
	}

	const order =
		orderData as unknown as Order;

	if (order.status === "paid") {
		await supabase
			.from(
				"processed_webhook_events"
			)
			.insert({
				event_id: eventId,
				event_type:
					webhookEvent.event,
			});

		return new Response(
			"Order already paid",
			{ status: 200 }
		);
	}

	const expectedAmount =
		order.total_amount * 100;

	const amountPaid =
		Number(
			payment?.amount ??
			paymentLink.amount_paid ??
			0
		);

	if (amountPaid !== expectedAmount) {
		console.error(
			"Payment amount mismatch:",
			{
				expected: expectedAmount,
				received: amountPaid,
			}
		);

		return new Response(
			"Amount mismatch",
			{ status: 400 }
		);
	}

	const { error: updateError } =
		await supabase
			.from("orders")
			.update({
				status: "paid",
				razorpay_payment_id:
					payment?.id ?? null,
				paid_at:
					new Date().toISOString(),
				updated_at:
					new Date().toISOString(),
			})
			.eq("id", order.id)
			.neq("status", "paid");

	if (updateError) {
		console.error(
			"Order payment update failed:",
			updateError
		);

		return new Response(
			"Database error",
			{ status: 500 }
		);
	}

	const { error: eventError } =
		await supabase
			.from(
				"processed_webhook_events"
			)
			.insert({
				event_id: eventId,
				event_type:
					webhookEvent.event,
			});

	if (eventError) {
		console.error(
			"Webhook event save failed:",
			eventError
		);
	}

	const { data: orderItemsData } =
		await supabase
			.from("order_items")
			.select(
				"product_name, quantity, unit_price, line_total"
			)
			.eq("order_id", order.id)
			.order("id", {
				ascending: true,
			});

	const itemLines: string[] = [];

	if (
		orderItemsData &&
		orderItemsData.length > 0
	) {
		for (const item of orderItemsData) {
			itemLines.push(
				`${item.product_name}: ${item.quantity} × ₹${item.unit_price}`
			);
		}
	} else {
		itemLines.push(
			`${order.product_name}: ${order.quantity} × ₹${order.unit_price}`
		);
	}

	await sendWhatsAppMessage(
		order.customer_phone,
		[
			"✅ Payment received",
			"",
			`Order: #${order.id}`,
			"",
			...itemLines,
			"",
			`Amount: ₹${order.total_amount}`,
			"Status: Confirmed",
			"",
			"Thank you for your order!",
		].join("\n"),
		env
	);

	return new Response(
		"Payment processed",
		{ status: 200 }
	);
}

/*
|--------------------------------------------------------------------------
| Main Cloudflare Worker
|--------------------------------------------------------------------------
*/
/*
|--------------------------------------------------------------------------
| Workers AI response generator
|--------------------------------------------------------------------------
*/

async function generateAIResponse(
	customerMessage: string,
	env: Env
): Promise<string> {
	return generateRAGResponse(customerMessage, {
		AI: env.AI,
		SUPABASE_URL: env.SUPABASE_URL,
		SUPABASE_SERVICE_ROLE_KEY: env.SUPABASE_SERVICE_ROLE_KEY,
		SUPABASE_ANON_KEY: env.SUPABASE_ANON_KEY,
		OPENAI_API_KEY: env.OPENAI_API_KEY,
		OPENAI_CHAT_MODEL: env.OPENAI_CHAT_MODEL,
		RAG_MATCH_THRESHOLD: env.RAG_MATCH_THRESHOLD,
	});
}

function isAdminRequest(request: Request, env: Env): boolean {
	return Boolean(
		env.ADMIN_API_TOKEN &&
		request.headers.get("Authorization") === `Bearer ${env.ADMIN_API_TOKEN}`
	);
}

// Agent identity must be a short identifier (name, employee code, email —
// e.g. "Priya Singh", "agent-042"), never chat message text. A production
// incident showed a whole customer-facing sentence ("how can i help you")
// submitted as agentId on an /accept call — this is the server-side guard
// against that entire class of mistake, independent of what any client
// (dashboard UI, Postman, a future client) actually sends.
export function isValidAgentId(value: string): boolean {
	const trimmed = value.trim();
	if (!trimmed || trimmed.length > 40) {
		return false;
	}
	if (trimmed.includes("?")) {
		return false;
	}
	return trimmed.split(/\s+/).length <= 4;
}

function getAdminStatusErrorResponse(error: unknown): Response {
	const message = error instanceof Error ? error.message : "Admin order status update failed";
	const status = message === "Order not found"
		? 404
		: message.startsWith("Invalid order status transition")
			? 409
			: message.startsWith("Unsupported order status") || message.startsWith("Order status is required")
				? 400
				: 500;

	return Response.json({ error: message }, { status });
}

function getAdminDeliveryStatusErrorResponse(error: unknown): Response {
	const message = error instanceof Error ? error.message : "Admin delivery status update failed";
	const status = message.includes("Delivery record not found")
		? 404
		: message.startsWith("Invalid delivery status transition")
			? 409
			: 500;

	return Response.json({ error: message }, { status });
}


async function handleRequest(
  request: Request,
  env: Env,
  ctx: ExecutionContext
): Promise<Response> {
  const url = new URL(request.url);

  console.log(
    "[REQUEST]",
    request.method,
    url.pathname
  );


		if (request.method === "GET" && url.pathname === "/message") {
			console.log("[RETURN] GET /message 200");
			return new Response("Hello, World!", { status: 200 });
		}

		if (request.method === "GET" && url.pathname === "/random") {
			console.log("[RETURN] GET /random 200");
			return new Response(crypto.randomUUID(), { status: 200 });
		}
		/*
|--------------------------------------------------------------------------
| Temporary Workers AI test route
|--------------------------------------------------------------------------
*/

if (
	request.method === "GET" &&
	url.pathname === "/ai-test"
) {
	console.log("[ROUTE] GET /ai-test");
	const question =
		url.searchParams.get(
			"question"
		) ??
		"What can the Innova Solutions WhatsApp bot help me with?";

	const answer =
		await generateAIResponse(
			question,
			env
		);

	console.log("[RETURN] GET /ai-test 200");
	return Response.json({
		success: true,
		question,
		answer,
	});
}

		/*
		|--------------------------------------------------------------------------
		| Admin orders API
		|--------------------------------------------------------------------------
		*/

		if (request.method === "GET" && url.pathname === "/api/admin/orders") {
			if (!env.ADMIN_API_TOKEN) {
				return Response.json(
					{ error: "Admin API is not configured" },
					{ status: 503 }
				);
			}

			if (!isAdminRequest(request, env)) {
				return Response.json({ error: "Unauthorized" }, { status: 401 });
			}

			try {
				type CustomerSummary = { name: string | null; whatsapp_number: string };
				type OrderWithCustomer = Order & {
					customer?: CustomerSummary | null;
					order_items?: Array<{ product_name: string; quantity: number }>;
					status_history?: Array<Record<string, unknown>>;
				};
				const orders: OrderWithCustomer[] = [];
				const pageSize = 1000;
				const client = getAdminClient(env);
				let from = 0;
				let page: OrderWithCustomer[];

				do {
					const { data, error } = await client
						.from("orders")
						.select("*, customer:customers(name, whatsapp_number), order_items(product_name, quantity)")
						.order("created_at", { ascending: false })
						.range(from, from + pageSize - 1);

					if (error) {
						throw new Error(error.message);
					}

					page = (data ?? []) as OrderWithCustomer[];
					orders.push(...page);
					from += pageSize;
				} while (page.length === pageSize);

				const statusHistoryByOrder = new Map<number, Array<Record<string, unknown>>>();
				if (orders.length > 0) {
					const { data: statusHistory, error: historyError } = await client
						.from("order_status_history")
						.select("*")
						.in("order_id", orders.map((order) => order.id))
						.order("created_at", { ascending: true });
					if (historyError) throw new Error(historyError.message);
					for (const entry of (statusHistory ?? []) as Array<Record<string, unknown>>) {
						const orderId = Number(entry.order_id);
						statusHistoryByOrder.set(orderId, [
							...(statusHistoryByOrder.get(orderId) ?? []),
							entry,
						]);
					}
				}

				const fallbackPhones = [...new Set(
					orders
						.filter((order) => !order.customer?.name && order.customer_phone)
						.map((order) => order.customer_phone)
				)];
				const customersByPhone = new Map<string, CustomerSummary>();
				if (fallbackPhones.length > 0) {
					const { data: fallbackCustomers, error: fallbackError } = await client
						.from("customers")
						.select("name, whatsapp_number")
						.in("whatsapp_number", fallbackPhones);
					if (fallbackError) {
						throw new Error(fallbackError.message);
					}
					for (const customer of (fallbackCustomers ?? []) as CustomerSummary[]) {
						customersByPhone.set(customer.whatsapp_number, customer);
					}
				}
				const customersEnriched = orders.map(({ customer, order_items, ...order }) => {
					const items = order_items ?? [];
					return {
						...order,
						customer_name:
							customer?.name ||
							customersByPhone.get(order.customer_phone)?.name ||
							null,
						product_name:
							items.map((item) => item.product_name).filter(Boolean).join(", ") ||
							(order as Order & { product_name?: string }).product_name ||
							null,
						quantity:
							items.length > 0
								? items.reduce((total, item) => total + Number(item.quantity || 0), 0)
								: (order as Order & { quantity?: number }).quantity ?? 1,
						status_history: statusHistoryByOrder.get(Number(order.id)) ?? [],
					};
				});

				return Response.json({
					success: true,
					count: customersEnriched.length,
					orders: customersEnriched,
				});
			} catch (error) {
				console.error("Admin order list failed:", error);
				return Response.json(
					{ success: false, error: "Could not load orders" },
					{ status: 500 }
				);
			}
		}
		
if (
  request.method === "POST" &&
  url.pathname === "/api/admin/customers"
) {
  if (!env.ADMIN_API_TOKEN) {
    return Response.json(
      { error: "Admin API is not configured" },
      { status: 503 }
    );
  }

  if (!isAdminRequest(request, env)) {
    return Response.json(
      { error: "Unauthorized" },
      { status: 401 }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Request body must be valid JSON" }, { status: 400 });
  }

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return Response.json({ error: "Request body must be an object" }, { status: 400 });
  }

  const input = body as Record<string, unknown>;
  const name = typeof input.customer_name === "string" ? input.customer_name.trim() : "";
  const rawPhone = typeof input.whatsapp_number === "string" ? input.whatsapp_number.trim() : "";
  const email = typeof input.email === "string" ? input.email.trim() : "";
  const phoneDigits = rawPhone.replace(/\D/g, "");
  const whatsappNumber =
    phoneDigits.length === 10
      ? `91${phoneDigits}`
      : phoneDigits.startsWith("0") && phoneDigits.length === 11
        ? `91${phoneDigits.slice(1)}`
        : phoneDigits;

  if (!name) {
    return Response.json({ error: "Customer name is required" }, { status: 400 });
  }

  if (name.length > 200) {
    return Response.json({ error: "Customer name must be 200 characters or fewer" }, { status: 400 });
  }

  if (phoneDigits.length < 10 || phoneDigits.length > 15) {
    return Response.json({ error: "A valid phone number is required" }, { status: 400 });
  }

  if (input.email !== undefined && input.email !== null && typeof input.email !== "string") {
    return Response.json({ error: "Email address must be text" }, { status: 400 });
  }

  if (email && (
    email.length > 320 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
  )) {
    return Response.json({ error: "A valid email address is required" }, { status: 400 });
  }

  try {
    const supabase = getAdminClient(env);
    const pageSize = 1000;
    let from = 0;
    let phonePage: Array<{ whatsapp_number: string }>;
    do {
      const { data, error } = await supabase
        .from("customers")
        .select("whatsapp_number")
        .range(from, from + pageSize - 1);
      if (error) throw new Error(error.message);
      phonePage = (data ?? []) as Array<{ whatsapp_number: string }>;
      const duplicate = phonePage.some((customer) => {
        const existingDigits = String(customer.whatsapp_number ?? "").replace(/\D/g, "");
        const existingCanonical =
          existingDigits.length === 10
            ? `91${existingDigits}`
            : existingDigits.startsWith("0") && existingDigits.length === 11
              ? `91${existingDigits.slice(1)}`
              : existingDigits;
        return existingCanonical === whatsappNumber;
      });
      if (duplicate) {
        return Response.json(
          { error: "A customer with this phone number already exists" },
          { status: 409 }
        );
      }
      from += pageSize;
    } while (phonePage.length === pageSize);

    const { data: customer, error } = await supabase
      .from("customers")
      .insert({
        name,
        whatsapp_number: whatsappNumber,
        email: email || null,
      })
      .select("*")
      .single();

    if (error) {
      if (error.code === "23505") {
        return Response.json(
          { error: "A customer with this phone number already exists" },
          { status: 409 }
        );
      }
      throw new Error(error.message);
    }

    return Response.json({ success: true, customer }, { status: 201 });
  } catch (error) {
    console.error("Admin customer creation failed:", error);
    return Response.json(
      { success: false, error: "Could not create customer" },
      { status: 500 }
    );
  }
}

if (
  request.method === "GET" &&
  url.pathname === "/api/admin/customers"
) {
  if (!env.ADMIN_API_TOKEN) {
    return Response.json(
      { error: "Admin API is not configured" },
      { status: 503 }
    );
  }

  if (!isAdminRequest(request, env)) {
    return Response.json(
      { error: "Unauthorized" },
      { status: 401 }
    );
  }

  try {
    const { data, error } = await getAdminClient(env)
      .from("customers")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) throw new Error(error.message);
	
const { data: orders, error: ordersError } = await getAdminClient(env)
  .from("orders")
  .select("id, customer_id, customer_phone, created_at");

if (ordersError) throw new Error(ordersError.message);
const canonicalPhone = (value: string | null | undefined) => {
  const digits = String(value ?? "").replace(/\D/g, "");
  if (digits.length === 10) return `91${digits}`;
  if (digits.startsWith("0") && digits.length === 11) return `91${digits.slice(1)}`;
  return digits;
};
const customersWithOrderStats = (data ?? []).map((customer) => {
  const customerOrders = (orders ?? []).filter(
(order) =>
  String(order.customer_id) === String(customer.id) ||
  canonicalPhone(order.customer_phone) === canonicalPhone(customer.whatsapp_number)
  );

  const latestOrder = customerOrders.reduce<
    (typeof customerOrders)[number] | null
  >((latest, order) => {
    if (!latest) return order;

    return new Date(order.created_at).getTime() >
      new Date(latest.created_at).getTime()
      ? order
      : latest;
  }, null);

  return {
    ...customer,
    total_orders: customerOrders.length,
    last_order: latestOrder?.created_at ?? null,
  };
});

    return Response.json({
  success: true,
  count: customersWithOrderStats.length,
  customers: customersWithOrderStats,
});
  } catch (error) {
    console.error("Admin customer list failed:", error);

    return Response.json(
      { success: false, error: "Could not load customers" },
      { status: 500 }
    );
  }
}



/*
|--------------------------------------------------------------------------
| Admin customer details API
|--------------------------------------------------------------------------
*/


const customerHistoryMatch = url.pathname.match(
  /^\/api\/admin\/customers\/(\d+)\/history$/
);

if (request.method === "GET" && customerHistoryMatch) {
  if (!env.ADMIN_API_TOKEN) {
    return Response.json({ error: "Admin API is not configured" }, { status: 503 });
  }
  if (!isAdminRequest(request, env)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const customerId = Number(customerHistoryMatch[1]);
  if (!Number.isSafeInteger(customerId) || customerId <= 0) {
    return Response.json({ error: "Invalid customer ID" }, { status: 400 });
  }

  try {
    const supabase = getAdminClient(env);
    const { data: customer, error: customerError } = await supabase
      .from("customers")
      .select("id, whatsapp_number")
      .eq("id", customerId)
      .maybeSingle();
    if (customerError) throw new Error(customerError.message);
    if (!customer) {
      return Response.json({ error: "Customer not found" }, { status: 404 });
    }

    const [
      ordersResult,
      phoneOrdersResult,
      ticketsResult,
      sessionsResult,
      notificationsResult,
      stateResult,
      contextResult,
    ] = await Promise.all([
      supabase.from("orders").select("*").eq("customer_id", customerId)
        .order("created_at", { ascending: false }),
      supabase.from("orders").select("*").eq("customer_phone", customer.whatsapp_number)
        .order("created_at", { ascending: false }),
      supabase.from("support_tickets").select("*").eq("customer_id", customerId)
        .order("created_at", { ascending: false }),
      supabase.from("support_sessions").select("*").eq("customer_id", customerId)
        .order("created_at", { ascending: false }),
      supabase.from("notification_events").select("*")
        .eq("customer_phone", customer.whatsapp_number)
        .order("created_at", { ascending: false }),
      supabase.from("conversation_state").select("*")
        .eq("whatsapp_number", customer.whatsapp_number).maybeSingle(),
      supabase.from("conversation_context").select("*")
        .eq("phone_number", customer.whatsapp_number).maybeSingle(),
    ]);

    const queryErrors = [
      ordersResult.error,
      phoneOrdersResult.error,
      ticketsResult.error,
      sessionsResult.error,
      notificationsResult.error,
      stateResult.error,
      contextResult.error,
    ].filter(Boolean);
    if (queryErrors.length) {
      throw new Error(queryErrors.map((error) => error?.message).join("; "));
    }

    const ordersById = new Map<number, Record<string, unknown>>();
    for (const order of [...(ordersResult.data ?? []), ...(phoneOrdersResult.data ?? [])]) {
      ordersById.set(Number(order.id), order as Record<string, unknown>);
    }
    const orders = [...ordersById.values()];
    const orderIds = orders.map((order) => order.id);
    const ticketIds = (ticketsResult.data ?? []).map((ticket) => ticket.id);
    const [itemsResult, statusHistoryResult, deliveryResult, messagesResult, supportMessagesResult] =
      await Promise.all([
        orderIds.length
          ? supabase.from("order_items").select("*").in("order_id", orderIds)
          : Promise.resolve({ data: [], error: null }),
        orderIds.length
          ? supabase.from("order_status_history").select("*").in("order_id", orderIds)
            .order("created_at", { ascending: false })
          : Promise.resolve({ data: [], error: null }),
        orderIds.length
          ? supabase.from("order_delivery_details")
            .select("*, delivery_address:delivery_addresses(*)")
            .in("order_id", orderIds)
          : Promise.resolve({ data: [], error: null }),
        ticketIds.length
          ? supabase.from("ticket_messages").select("*").in("ticket_id", ticketIds)
            .order("created_at", { ascending: false })
          : Promise.resolve({ data: [], error: null }),
        ticketIds.length
          ? supabase.from("support_messages").select("*").in("ticket_id", ticketIds)
            .order("created_at", { ascending: false })
          : Promise.resolve({ data: [], error: null }),
      ]);

    const secondaryErrors = [
      itemsResult.error,
      statusHistoryResult.error,
      deliveryResult.error,
      messagesResult.error,
      supportMessagesResult.error,
    ].filter(Boolean);
    if (secondaryErrors.length) {
      throw new Error(secondaryErrors.map((error) => error?.message).join("; "));
    }

    const itemsByOrder = new Map<number, Array<Record<string, unknown>>>();
    for (const item of (itemsResult.data ?? []) as Array<Record<string, unknown>>) {
      const orderId = Number(item.order_id);
      itemsByOrder.set(orderId, [...(itemsByOrder.get(orderId) ?? []), item]);
    }
    const orderHistoryByOrder = new Map<number, Array<Record<string, unknown>>>();
    for (const entry of (statusHistoryResult.data ?? []) as Array<Record<string, unknown>>) {
      const orderId = Number(entry.order_id);
      orderHistoryByOrder.set(orderId, [...(orderHistoryByOrder.get(orderId) ?? []), entry]);
    }
    const deliveryByOrder = new Map<number, Record<string, unknown>>();
    for (const delivery of (deliveryResult.data ?? []) as Array<Record<string, unknown>>) {
      deliveryByOrder.set(Number(delivery.order_id), delivery);
    }
    const ordersWithHistory = orders.map((order) => ({
      ...order,
      order_items: itemsByOrder.get(Number(order.id)) ?? [],
      status_history: orderHistoryByOrder.get(Number(order.id)) ?? [],
      delivery: deliveryByOrder.get(Number(order.id)) ?? null,
    }));

    return Response.json({
      success: true,
      history: {
        orders: ordersWithHistory,
        support_tickets: ticketsResult.data ?? [],
        support_sessions: sessionsResult.data ?? [],
        ticket_messages: messagesResult.data ?? [],
        support_messages: supportMessagesResult.data ?? [],
        notification_events: notificationsResult.data ?? [],
        conversation_state: stateResult.data ?? null,
        conversation_context: contextResult.data ?? null,
      },
    });
  } catch (error) {
    console.error("Admin customer history failed:", error);
    return Response.json(
      { success: false, error: "Could not load customer history" },
      { status: 500 }
    );
  }
}

const customerDetailsMatch = url.pathname.match(
  /^\/api\/admin\/customers\/([^/]+)$/
);

if (
  (request.method === "GET" || request.method === "PATCH") &&
  customerDetailsMatch
) {
  if (!env.ADMIN_API_TOKEN) {
    return Response.json(
      { error: "Admin API is not configured" },
      { status: 503 }
    );
  }

  if (!isAdminRequest(request, env)) {
    return Response.json(
      { error: "Unauthorized" },
      { status: 401 }
    );
  }

  try {
    const customerId = customerDetailsMatch[1];
    const supabase = getAdminClient(env);

    if (request.method === "GET") {
      const { data, error } = await supabase
        .from("customers")
        .select("*")
        .eq("id", customerId)
        .maybeSingle();

      if (error) throw new Error(error.message);

      if (!data) {
        return Response.json(
          { error: "Customer not found" },
          { status: 404 }
        );
      }

      return Response.json({
        success: true,
        customer: data,
      });
    }

    const updates = await request.json();

    // Only allow fields that the Edit Customer form updates.
    const allowedFields = ["name", "email", "phone"];
    const safeUpdates: Record<string, unknown> = {};

    for (const field of allowedFields) {
      if (Object.prototype.hasOwnProperty.call(updates, field)) {
        safeUpdates[field] = updates[field];
      }
    }

    if (Object.keys(safeUpdates).length === 0) {
      return Response.json(
        { error: "No valid customer fields provided" },
        { status: 400 }
      );
    }

    const { data, error } = await supabase
      .from("customers")
      .update(safeUpdates)
      .eq("id", customerId)
      .select("*")
      .maybeSingle();

    if (error) throw new Error(error.message);

    if (!data) {
      return Response.json(
        { error: "Customer not found" },
        { status: 404 }
      );
    }

    return Response.json({
      success: true,
      customer: data,
    });
  } catch (error) {
    console.error("Admin customer details failed:", error);

    return Response.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Could not process customer request",
      },
      { status: 500 }
    );
  }
}

/*
|--------------------------------------------------------------------------
| Admin carts API
|--------------------------------------------------------------------------
*/

if (
  request.method === "GET" &&
  url.pathname === "/api/admin/carts"
) {
  if (!env.ADMIN_API_TOKEN) {
    return Response.json(
      { error: "Admin API is not configured" },
      { status: 503 }
    );
  }

  if (!isAdminRequest(request, env)) {
    return Response.json(
      { error: "Unauthorized" },
      { status: 401 }
    );
  }

  try {
    const supabase = getAdminClient(env);

    // Fetch carts, newest first.
    const { data: carts, error: cartsError } = await supabase
      .from("carts")
      .select("*")
      .order("updated_at", { ascending: false });

    if (cartsError) throw new Error(cartsError.message);

    // Fetch all cart items.
    const { data: items, error: itemsError } = await supabase
      .from("cart_items")
      .select("*");

    if (itemsError) throw new Error(itemsError.message);

    // Attach each cart's products to the matching cart.
    const cartsWithItems = (carts ?? []).map((cart) => ({
      ...cart,
      items: (items ?? []).filter(
        (item) => String(item.cart_id) === String(cart.id)
      ),
    }));

    return Response.json({
      success: true,
      count: cartsWithItems.length,
      carts: cartsWithItems,
    });
  } catch (error) {
    console.error("Admin cart list failed:", error);

    return Response.json(
      { success: false, error: "Could not load carts" },
      { status: 500 }
    );
  }
}

/*
|--------------------------------------------------------------------------
| Admin products API
|--------------------------------------------------------------------------
*/

if (
  request.method === "GET" &&
  url.pathname === "/api/admin/products"
) {
  if (!env.ADMIN_API_TOKEN) {
    return Response.json(
      { error: "Admin API is not configured" },
      { status: 503 }
    );
  }

  if (!isAdminRequest(request, env)) {
    return Response.json(
      { error: "Unauthorized" },
      { status: 401 }
    );
  }

  try {
    const supabase = getAdminClient(env);

    const { data: products, error } = await supabase
      .from("products")
      .select("id, created_at, name, price, description, stock, is_active")
      .order("created_at", { ascending: false });

    if (error) throw new Error(error.message);

    return Response.json({
      success: true,
      count: products?.length ?? 0,
      products: products ?? [],
    });
  } catch (error) {
    console.error("Admin products list failed:", error);

    return Response.json(
      { success: false, error: "Could not load products" },
      { status: 500 }
    );
  }
}

/*
|--------------------------------------------------------------------------
| Admin update product API
|--------------------------------------------------------------------------
*/

const productUpdateMatch = url.pathname.match(
  /^\/api\/admin\/products\/(\d+)$/
);

if (
  request.method === "PATCH" &&
  productUpdateMatch
) {
  if (!env.ADMIN_API_TOKEN) {
    return Response.json(
      { error: "Admin API is not configured" },
      { status: 503 }
    );
  }

  if (!isAdminRequest(request, env)) {
    return Response.json(
      { error: "Unauthorized" },
      { status: 401 }
    );
  }

  try {
    const productId = Number(productUpdateMatch[1]);
    const body: unknown = await request.json();

    if (
      typeof body !== "object" ||
      body === null ||
      Array.isArray(body)
    ) {
      return Response.json(
        { error: "Invalid request body" },
        { status: 400 }
      );
    }

    const input = body as Record<string, unknown>;
    const allowedFields = [
      "name",
      "price",
      "description",
      "stock",
      "is_active",
    ];

    const updates: Record<string, unknown> = {};

    for (const key of Object.keys(input)) {
      if (!allowedFields.includes(key)) {
        return Response.json(
          { error: `Field not allowed: ${key}` },
          { status: 400 }
        );
      }

      updates[key] = input[key];
    }

    if (Object.keys(updates).length === 0) {
      return Response.json(
        { error: "No fields to update" },
        { status: 400 }
      );
    }

    if (
      "name" in updates &&
      (typeof updates.name !== "string" ||
        !updates.name.trim())
    ) {
      return Response.json(
        { error: "Product name is required" },
        { status: 400 }
      );
    }

    if (
      "price" in updates &&
      (typeof updates.price !== "number" ||
        !Number.isFinite(updates.price) ||
        updates.price < 0)
    ) {
      return Response.json(
        { error: "Price must be a non-negative number" },
        { status: 400 }
      );
    }

    if (
      "stock" in updates &&
      (!Number.isInteger(updates.stock) ||
        (updates.stock as number) < 0)
    ) {
      return Response.json(
        { error: "Stock must be a non-negative integer" },
        { status: 400 }
      );
    }

    if (
      "description" in updates &&
      typeof updates.description !== "string"
    ) {
      return Response.json(
        { error: "Description must be text" },
        { status: 400 }
      );
    }

    if (
      "is_active" in updates &&
      typeof updates.is_active !== "boolean"
    ) {
      return Response.json(
        { error: "is_active must be true or false" },
        { status: 400 }
      );
    }

    if ("name" in updates) {
      updates.name = (updates.name as string).trim();
    }

    const supabase = getAdminClient(env);

    const { data: product, error } = await supabase
      .from("products")
      .update(updates)
      .eq("id", productId)
      .select(
        "id, created_at, name, price, description, stock, is_active"
      )
      .maybeSingle();

    if (error) throw new Error(error.message);

    if (!product) {
      return Response.json(
        { error: "Product not found" },
        { status: 404 }
      );
    }

    return Response.json({
      success: true,
      product,
    });
  } catch (error) {
    console.error("Admin product update failed:", error);

    return Response.json(
      { success: false, error: "Could not update product" },
      { status: 500 }
    );
  }
}

/*
|--------------------------------------------------------------------------
| Admin conversations API
|--------------------------------------------------------------------------
*/

if (
  request.method === "GET" &&
  url.pathname === "/api/admin/conversations"
) {
  if (!env.ADMIN_API_TOKEN) {
    return Response.json(
      { error: "Admin API is not configured" },
      { status: 503 }
    );
  }

  if (!isAdminRequest(request, env)) {
    return Response.json(
      { error: "Unauthorized" },
      { status: 401 }
    );
  }

  try {
    const supabase = getAdminClient(env);

    const [
      { data: contexts, error: contextsError },
      { data: states, error: statesError },
    ] = await Promise.all([
      supabase
        .from("conversation_context")
        .select("phone_number, last_product, last_order_id, last_intent, updated_at")
        .order("updated_at", { ascending: false })
        .limit(500),

      supabase
        .from("conversation_state")
        .select("id, whatsapp_number, state, context, last_message, created_at, updated_at")
        .order("updated_at", { ascending: false })
        .limit(500),
    ]);

    if (contextsError) throw new Error(contextsError.message);
    if (statesError) throw new Error(statesError.message);

    return Response.json({
      success: true,
      contexts: contexts ?? [],
      states: states ?? [],
    });
  } catch (error) {
    console.error("Admin conversations list failed:", error);

    return Response.json(
      { success: false, error: "Could not load conversations" },
      { status: 500 }
    );
  }
}



/*
|--------------------------------------------------------------------------
| Admin customer orders API
|--------------------------------------------------------------------------
*/

const manualCustomerOrderMatch = url.pathname.match(
  /^\/api\/admin\/customers\/(\d+)\/orders$/
);

if (request.method === "POST" && manualCustomerOrderMatch) {
  if (!env.ADMIN_API_TOKEN) {
    return Response.json({ error: "Admin API is not configured" }, { status: 503 });
  }
  if (!isAdminRequest(request, env)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const customerId = Number(manualCustomerOrderMatch[1]);
  if (!Number.isSafeInteger(customerId) || customerId <= 0) {
    return Response.json({ error: "Invalid customer ID" }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Request body must be valid JSON" }, { status: 400 });
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return Response.json({ error: "Request body must be an object" }, { status: 400 });
  }

  const input = body as Record<string, unknown>;
  const productId = Number(input.product_id);
  const quantity = Number(input.quantity);
  const unitPrice = Number(input.unit_price);
  const notes = typeof input.notes === "string" ? input.notes.trim() : "";
  const initialStatus = typeof input.initial_status === "string"
    ? input.initial_status
    : "pending";
  const deliveryAddress = input.delivery_address;
  const validStatuses = [
    "pending", "payment_pending", "paid", "failed", "cancelled",
    "fulfilled", "PACKED", "SHIPPED", "OUT_FOR_DELIVERY", "DELIVERED",
  ];

  if (!Number.isSafeInteger(productId) || productId <= 0) {
    return Response.json({ error: "A valid product is required" }, { status: 400 });
  }
  if (!Number.isSafeInteger(quantity) || quantity <= 0) {
    return Response.json({ error: "Quantity must be a positive whole number" }, { status: 400 });
  }
  if (
    input.unit_price === undefined ||
    input.unit_price === null ||
    input.unit_price === "" ||
    !Number.isFinite(unitPrice) ||
    unitPrice < 0 ||
    unitPrice > 999999999
  ) {
    return Response.json({ error: "Price must be a valid non-negative amount" }, { status: 400 });
  }
  if (notes.length > 2000) {
    return Response.json({ error: "Notes must be 2000 characters or fewer" }, { status: 400 });
  }
  if (!validStatuses.includes(initialStatus)) {
    return Response.json({ error: "Unsupported initial order status" }, { status: 400 });
  }
  if (!deliveryAddress || typeof deliveryAddress !== "object" || Array.isArray(deliveryAddress)) {
    return Response.json({ error: "Delivery address is required" }, { status: 400 });
  }

  const address = deliveryAddress as Record<string, unknown>;
  const requiredAddressFields = ["address_line_1", "city", "state", "pincode"];
  if (requiredAddressFields.some(
    (field) => typeof address[field] !== "string" || !address[field].trim()
  ) || typeof address.pincode !== "string" || !/^\d{6}$/.test(address.pincode.trim())) {
    return Response.json(
      { error: "Address, city, state, and a valid six-digit pincode are required" },
      { status: 400 }
    );
  }
  const optionalAddressFields = [
    "recipient_name", "recipient_phone", "email",
    "address_line_2", "landmark",
  ];
  if (optionalAddressFields.some(
    (field) => address[field] !== undefined && typeof address[field] !== "string"
  )) {
    return Response.json({ error: "Delivery address fields must be text" }, { status: 400 });
  }

  try {
    const { data, error } = await getAdminClient(env).rpc("create_admin_order", {
      p_customer_id: customerId,
      p_product_id: productId,
      p_quantity: quantity,
      p_unit_price: unitPrice,
      p_notes: notes || null,
      p_delivery_address: address,
      p_initial_status: initialStatus,
    });

    if (error) {
      if (error.code === "P0002") {
        return Response.json(
          { error: error.message.includes("Customer") ? "Customer not found" : "Active product not found" },
          { status: 404 }
        );
      }
      if (error.code === "22023") {
        return Response.json({ error: error.message }, { status: 400 });
      }
      if (error.code === "PGRST202") {
        console.error("[ADMIN_ORDER_CREATE] Database function unavailable", {
          code: error.code,
        });
        return Response.json(
          {
            success: false,
            error:
              "Order creation is unavailable because create_admin_order() is missing from this Supabase project's API schema. Apply supabase/migrations/016_admin_crm_orders.sql to the project configured by SUPABASE_URL, then retry.",
          },
          { status: 503 }
        );
      }
      if (error.code === "23502" && error.message.includes("profile_name")) {
        console.error("[ADMIN_ORDER_CREATE] Delivery-address schema mismatch", {
          code: error.code,
          column: "profile_name",
        });
        return Response.json(
          {
            success: false,
            error:
              "The manual-order database function is outdated for this project's delivery-address schema. Apply supabase/migrations/017_fix_manual_order_delivery_address.sql, then retry.",
          },
          { status: 503 }
        );
      }
      throw new Error(error.message);
    }

    const result = data as {
      order?: Record<string, unknown>;
      item?: Record<string, unknown>;
      delivery_address?: Record<string, unknown>;
    } | null;
    if (!result?.order) {
      throw new Error("Order creation returned no order");
    }
    return Response.json(
      { success: true, ...result },
      { status: 201 }
    );
  } catch (error) {
    console.error("Admin manual order creation failed:", error);
    return Response.json(
      { success: false, error: "Could not create order" },
      { status: 500 }
    );
  }
}

const customerOrdersMatch = url.pathname.match(
  /^\/api\/admin\/customers\/([^/]+)\/orders$/
);

if (request.method === "GET" && customerOrdersMatch) {
  if (!env.ADMIN_API_TOKEN) {
    return Response.json(
      { error: "Admin API is not configured" },
      { status: 503 }
    );
  }

  if (!isAdminRequest(request, env)) {
    return Response.json(
      { error: "Unauthorized" },
      { status: 401 }
    );
  }

  try {
    const customerId = customerOrdersMatch[1];

    const { data, error } = await getAdminClient(env)
      .from("orders")
      .select("*")
      .eq("customer_id", customerId)
      .order("created_at", { ascending: false });

    if (error) throw new Error(error.message);

    return Response.json({
      success: true,
      count: data?.length ?? 0,
      orders: data ?? [],
    });
  } catch (error) {
    console.error("Admin customer orders failed:", error);

    return Response.json(
      { success: false, error: "Could not load customer orders" },
      { status: 500 }
    );
  }
}


		/*
		|--------------------------------------------------------------------------
		| Admin order status API
		|--------------------------------------------------------------------------
		*/

		const adminStatusMatch = url.pathname.match(/^\/api\/admin\/orders\/(\d+)\/status$/);
		if (request.method === "POST" && adminStatusMatch) {
			if (!env.ADMIN_API_TOKEN) {
				return Response.json(
					{ error: "Admin API is not configured" },
					{ status: 503 }
				);
			}

			if (!isAdminRequest(request, env)) {
				return Response.json({ error: "Unauthorized" }, { status: 401 });
			}

			const orderId = Number(adminStatusMatch[1]);
			let body: AdminOrderStatusRequest;
			try {
				body = await request.json() as AdminOrderStatusRequest;
			} catch {
				return Response.json({ error: "Request body must be valid JSON" }, { status: 400 });
			}

			if (!body.status || typeof body.status !== "string") {
				return Response.json({ error: "Order status is required" }, { status: 400 });
			}

			try {
				const previousStatus = await getOrderStatus(orderId, env);
				const order = await updateOrderStatus(
					orderId,
					body.status as OrderStatus,
					env,
					{
						changedBy: body.changed_by ?? "admin-api",
						changedByRole: body.changed_by_role ?? "admin",
						reason: body.reason ?? null,
					}
				);
				console.log("[STATUS_UPDATE]", {
					orderId,
					oldStatus: previousStatus,
					newStatus: order.status,
				});
				if (previousStatus !== order.status) {
					await sendOrderStatusNotification(order, previousStatus, env);
				}
				const timeline = await getOrderTimeline(orderId, env);
				const { data: notificationEvent, error: notificationLookupError } = await getAdminClient(env)
					.from("notification_events")
					.select("*")
					.eq("order_id", orderId)
					.order("created_at", { ascending: false })
					.limit(1)
					.maybeSingle();

				if (notificationLookupError) {
					console.error("[NOTIFICATION_ERROR]", {
						orderId,
						stage: "response_event_lookup",
						error: notificationLookupError.message,
					});
				}

				return Response.json({
					order,
					timeline,
					notification_event: notificationLookupError ? null : notificationEvent,
				});
			} catch (error) {
				console.error("Admin order status update failed:", error);
				return getAdminStatusErrorResponse(error);
			}
		}

		const adminDeliveryStatusMatch = url.pathname.match(
			/^\/api\/admin\/orders\/(\d+)\/delivery-status$/
		);
		if (request.method === "POST" && adminDeliveryStatusMatch) {
			if (!env.ADMIN_API_TOKEN) {
				return Response.json(
					{ error: "Admin API is not configured" },
					{ status: 503 }
				);
			}
			if (!isAdminRequest(request, env)) {
				return Response.json({ error: "Unauthorized" }, { status: 401 });
			}

			const orderId = Number(adminDeliveryStatusMatch[1]);
			let body: AdminOrderDeliveryStatusRequest;
			try {
				body = await request.json() as AdminOrderDeliveryStatusRequest;
			} catch {
				return Response.json({ error: "Request body must be valid JSON" }, { status: 400 });
			}

			const validStatuses: readonly DeliveryStatus[] = [
				"PENDING_DETAILS",
				"DETAILS_RECEIVED",
				"READY_FOR_DELIVERY",
				"OUT_FOR_DELIVERY",
				"DELIVERED",
			];
			if (!body.status || !validStatuses.includes(body.status as DeliveryStatus)) {
				return Response.json(
					{ error: "A valid delivery status is required" },
					{ status: 400 }
				);
			}

			try {
				const delivery = await updateOrderDeliveryStatus(
					orderId,
					body.status as DeliveryStatus,
					env
				);
				return Response.json({ delivery });
			} catch (error) {
				console.error("Admin delivery status update failed:", error);
				return getAdminDeliveryStatusErrorResponse(error);
			}
		}
		
/*
|--------------------------------------------------------------------------
| Admin customer delivery addresses API
|--------------------------------------------------------------------------
*/

const customerAddressesMatch = url.pathname.match(
  /^\/api\/admin\/customers\/([^/]+)\/addresses$/
);

if (request.method === "GET" && customerAddressesMatch) {
  if (!env.ADMIN_API_TOKEN) {
    return Response.json(
      { error: "Admin API is not configured" },
      { status: 503 }
    );
  }

  if (!isAdminRequest(request, env)) {
    return Response.json(
      { error: "Unauthorized" },
      { status: 401 }
    );
  }

  try {
    const customerId = customerAddressesMatch[1];

    const { data, error } = await getAdminClient(env)
      .from("delivery_addresses")
      .select("*")
      .eq("customer_id", customerId)
      .eq("is_active", true)
      .order("is_default", { ascending: false })
      .order("created_at", { ascending: false });

    if (error) throw new Error(error.message);

    return Response.json({
      success: true,
      count: data?.length ?? 0,
      addresses: data ?? [],
    });
  } catch (error) {
    console.error("Admin customer addresses failed:", error);

    return Response.json(
      {
        success: false,
        error: "Could not load customer addresses",
      },
      { status: 500 }
    );
  }
}

/*
|--------------------------------------------------------------------------
| Admin create customer delivery address API
|--------------------------------------------------------------------------
*/

if (request.method === "POST" && customerAddressesMatch) {
  if (!env.ADMIN_API_TOKEN) {
    return Response.json(
      { error: "Admin API is not configured" },
      { status: 503 }
    );
  }

  if (!isAdminRequest(request, env)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const customerId = customerAddressesMatch[1];

    let body: Record<string, unknown>;
    try {
      body = await request.json() as Record<string, unknown>;
    } catch {
      return Response.json(
        { error: "Request body must be valid JSON" },
        { status: 400 }
      );
    }

    const requiredFields = [
      "profile_name",
      "recipient_name",
      "recipient_phone",
      "address_line_1",
      "city",
      "state",
      "pincode",
    ];

    for (const field of requiredFields) {
      if (
        typeof body[field] !== "string" ||
        !(body[field] as string).trim()
      ) {
        return Response.json(
          { error: `${field} is required` },
          { status: 400 }
        );
      }
    }

    if (!/^\d{6}$/.test(body.pincode as string)) {
      return Response.json(
        { error: "PIN code must contain exactly 6 digits" },
        { status: 400 }
      );
    }

    const { data: customer, error: customerError } =
      await getAdminClient(env)
        .from("customers")
        .select("id")
        .eq("id", customerId)
        .maybeSingle();

    if (customerError) throw new Error(customerError.message);

    if (!customer) {
      return Response.json(
        { error: "Customer not found" },
        { status: 404 }
      );
    }

    const addressPayload = {
      customer_id: customer.id,
      profile_name: (body.profile_name as string).trim(),
      recipient_name: (body.recipient_name as string).trim(),
      recipient_phone: (body.recipient_phone as string).trim(),
      email: typeof body.email === "string" ? body.email.trim() || null : null,
      address_line_1: (body.address_line_1 as string).trim(),
      address_line_2: typeof body.address_line_2 === "string" ? body.address_line_2.trim() || null : null,
      city: (body.city as string).trim(),
      state: (body.state as string).trim(),
      pincode: (body.pincode as string).trim(),
      landmark: typeof body.landmark === "string" ? body.landmark.trim() || null : null,
      is_default: body.is_default === true,
      is_active: true,
    };

    const { data, error } = await getAdminClient(env)
      .from("delivery_addresses")
      .insert(addressPayload)
      .select("*")
      .single();


if (error?.code === "23505") {
  return Response.json(
    {
      error: error.message,
      details: error.details,
      hint: error.hint,
      code: error.code,
    },
    { status: 409 }
  );
}

if (error) {
  console.error("Delivery address insert failed:", error);
  return Response.json(
    {
      success: false,
      error: error.message,
      code: error.code,
    },
    { status: 500 }
  );
}

if (!data) {
  return Response.json(
    { success: false, error: "Address was not returned after insertion" },
    { status: 500 }
  );
}


    return Response.json(
      { success: true, address: data },
      { status: 201 }
    );
  } catch (error) {
  console.error("Admin create customer address failed:", error);

  return Response.json(
    {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    },
    { status: 500 }
  );
}
}

/*
|--------------------------------------------------------------------------
| Admin set default customer address API
|--------------------------------------------------------------------------
*/

const addressDefaultMatch = url.pathname.match(
  /^\/api\/admin\/customers\/(\d+)\/addresses\/(\d+)\/default$/
);

if (request.method === "PATCH" && addressDefaultMatch) {
  if (!env.ADMIN_API_TOKEN) {
    return Response.json(
      { error: "Admin API is not configured" },
      { status: 503 }
    );
  }

  if (!isAdminRequest(request, env)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const customerId = Number(addressDefaultMatch[1]);
  const addressId = Number(addressDefaultMatch[2]);
  const client = getAdminClient(env);

  try {
    // Confirm that the selected address belongs to this customer.
    const { data: selected, error: lookupError } = await client
      .from("delivery_addresses")
      .select("id")
      .eq("id", addressId)
      .eq("customer_id", customerId)
      .eq("is_active", true)
      .maybeSingle();

    if (lookupError) throw new Error(lookupError.message);

    if (!selected) {
      return Response.json(
        { error: "Active address not found for this customer" },
        { status: 404 }
      );
    }

    // Find the current default so it can be restored if needed.
    const { data: previous, error: previousError } = await client
      .from("delivery_addresses")
      .select("id")
      .eq("customer_id", customerId)
      .eq("is_active", true)
      .eq("is_default", true)
      .maybeSingle();

    if (previousError) throw new Error(previousError.message);

    if (previous?.id === addressId) {
      return Response.json({ success: true, addressId });
    }

    // Clear the existing default first to satisfy the unique index.
    const { error: clearError } = await client
      .from("delivery_addresses")
      .update({ is_default: false })
      .eq("customer_id", customerId)
      .eq("is_active", true)
      .eq("is_default", true);

    if (clearError) throw new Error(clearError.message);

    // Set the selected address as default.
    const { data: updated, error: updateError } = await client
      .from("delivery_addresses")
      .update({ is_default: true })
      .eq("id", addressId)
      .eq("customer_id", customerId)
      .eq("is_active", true)
      .select("id, profile_name, is_default")
      .maybeSingle();

    if (updateError || !updated) {
      // Attempt to restore the previous default if the update fails.
      if (previous) {
        const { error: restoreError } = await client
          .from("delivery_addresses")
          .update({ is_default: true })
          .eq("id", previous.id)
          .eq("customer_id", customerId)
          .eq("is_active", true);

        if (restoreError) {
          console.error("Could not restore previous default:", restoreError);
        }
      }

      throw new Error(updateError?.message ?? "Could not set default address");
    }

    return Response.json({
      success: true,
      address: updated,
    });
  } catch (error) {
    console.error("Set default customer address failed:", error);

    return Response.json(
      {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}



		/*
		|--------------------------------------------------------------------------
		| Admin support ticket API
		|--------------------------------------------------------------------------
		*/

		const adminTicketMatch = url.pathname.match(/^\/api\/admin\/tickets\/(\d+)$/);
		const adminTicketStatusMatch = url.pathname.match(/^\/api\/admin\/tickets\/(\d+)\/status$/);
		const adminTicketReplyMatch = url.pathname.match(/^\/api\/admin\/tickets\/(\d+)\/reply$/);
		const adminTicketMessagesMatch = url.pathname.match(/^\/api\/admin\/tickets\/(\d+)\/messages$/);
		const isAdminTicketRoute =
			url.pathname === "/api/admin/tickets" ||
			adminTicketMatch ||
			adminTicketStatusMatch ||
			adminTicketReplyMatch ||
			adminTicketMessagesMatch;

		if (adminTicketMessagesMatch) {
			console.log("[ADMIN AGENT CHAT MATCH]", {
				method: request.method,
				pathname: url.pathname,
				ticketId: Number(adminTicketMessagesMatch[1]),
			});
		}

		if (isAdminTicketRoute && !env.ADMIN_API_TOKEN) {
			return Response.json(
				{ error: "Admin API is not configured" },
				{ status: 503 }
			);
		}

		if (isAdminTicketRoute && !isAdminRequest(request, env)) {
			return Response.json({ error: "Unauthorized" }, { status: 401 });
		}

		if (request.method === "GET" && url.pathname === "/api/admin/tickets") {
			const { data, error } = await getAdminClient(env)
				.from("support_tickets")
				.select("id, ticket_number, order_id, issue_type, status, created_at")
				.order("created_at", { ascending: false });

			if (error) {
				console.error("Admin ticket list failed:", error);
				return Response.json({ error: "Could not load support tickets" }, { status: 500 });
			}

			return Response.json({
				tickets: data ?? [],
			});
		}

		if (request.method === "POST" && adminTicketMessagesMatch) {
			console.log("[ADMIN AGENT CHAT POST]", {
				ticketId: Number(adminTicketMessagesMatch[1]),
			});

			let body: AdminTicketReplyRequest;
			try {
				body = await request.json() as AdminTicketReplyRequest;
			} catch {
				return Response.json({ error: "Request body must be valid JSON" }, { status: 400 });
			}

			const reply = body.message?.trim();
			if (!reply) {
				return Response.json({ error: "Message is required" }, { status: 400 });
			}

			try {
				const ticket = await getSupportTicket(Number(adminTicketMessagesMatch[1]), env);
				const message = await addSupportMessage(ticket.id, "AGENT", reply, env, "admin-api");

				console.log("[ADMIN AGENT CHAT SEND]", {
					ticketId: ticket.id,
					ticketNumber: ticket.ticket_number,
					customerPhone: ticket.customer_phone,
				});

				await sendWhatsAppMessage(
					ticket.customer_phone,
					[
						"Support Agent:",
						"",
						reply,
					].join("\n"),
					env
				);

				console.log("[ADMIN AGENT CHAT SUCCESS]", {
					ticketId: ticket.id,
					messageId: message.id,
				});

				return Response.json({ success: true });
			} catch (error) {
				if (error instanceof Error && error.message === "Support ticket not found") {
					return Response.json({ error: error.message }, { status: 404 });
				}

				console.error("Admin agent chat POST failed:", error);
				return Response.json({ error: "Could not send agent message" }, { status: 500 });
			}
		}

		if (request.method === "POST" && adminTicketReplyMatch) {
			let body: AdminTicketReplyRequest;
			try {
				body = await request.json() as AdminTicketReplyRequest;
			} catch {
				return Response.json({ error: "Request body must be valid JSON" }, { status: 400 });
			}

			const reply = body.message?.trim();
			if (!reply) {
				return Response.json({ error: "Message is required" }, { status: 400 });
			}

			try {
				const ticket = await getSupportTicket(Number(adminTicketReplyMatch[1]), env);
				const customerMessage = [
					"Support Agent:",
					"",
					reply,
				].join("\n");

				await sendWhatsAppMessage(ticket.customer_phone, customerMessage, env);

				const message = await addSupportMessage(ticket.id, "AGENT", reply, env, "admin-api");

				return Response.json({ message }, { status: 201 });
			} catch (error) {
				if (error instanceof Error && error.message === "Support ticket not found") {
					return Response.json({ error: error.message }, { status: 404 });
				}

				console.error("Admin ticket reply failed:", error);
				return Response.json({ error: "Could not send ticket reply" }, { status: 500 });
			}
		}

		if (request.method === "GET" && adminTicketMessagesMatch) {
			try {
				const ticket = await getSupportTicket(Number(adminTicketMessagesMatch[1]), env);
				const textMessages = await getSupportMessages(ticket.id, env);

				const { data: imageRows, error: imagesError } = await getAdminClient(env)
					.from("ticket_messages")
					.select("id, sender_type, media_id, image_url, created_at")
					.eq("ticket_id", ticket.id)
					.eq("message_type", "IMAGE")
					.order("created_at", { ascending: true });

				if (imagesError) {
					throw new Error(`Ticket image messages lookup failed: ${imagesError.message}`);
				}

				const normalizedMessages = [
					...textMessages.map((message) => ({
						id: `text-${message.id}`,
						type: "TEXT" as const,
						sender_type: message.sender_type,
						message_text: message.message_text,
						media_id: null as string | null,
						image_url: null as string | null,
						created_at: message.created_at,
					})),
					...(imageRows ?? []).map((image) => ({
						id: `image-${image.id}`,
						type: "IMAGE" as const,
						sender_type: image.sender_type,
						message_text: null as string | null,
						media_id: image.media_id as string | null,
						image_url: image.image_url as string | null,
						created_at: image.created_at,
					})),
				].sort(
					(a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
				);

				return Response.json({ messages: normalizedMessages, ticket_status: ticket.status });
			} catch (error) {
				if (error instanceof Error && error.message === "Support ticket not found") {
					return Response.json({ error: error.message }, { status: 404 });
				}

				console.error("Admin ticket messages lookup failed:", error);
				return Response.json({ error: "Could not load ticket messages" }, { status: 500 });
			}
		}

		if (request.method === "GET" && adminTicketMatch) {
			try {
				const ticket = await getSupportTicket(Number(adminTicketMatch[1]), env);
				return Response.json({
					ticket: {
						id: ticket.id,
						ticket_number: ticket.ticket_number,
						customer_phone: ticket.customer_phone,
						order_id: ticket.order_id,
						issue_type: ticket.issue_type,
						issue_description: ticket.issue_description,
						product_name: ticket.product_name,
						preferred_resolution: ticket.preferred_resolution,
						status: ticket.status,
						created_at: ticket.created_at,
					},
				});
			} catch (error) {
				if (error instanceof Error && error.message === "Support ticket not found") {
					return Response.json({ error: error.message }, { status: 404 });
				}

				console.error("Admin ticket lookup failed:", error);
				return Response.json({ error: "Could not load support ticket" }, { status: 500 });
			}
		}

		if (request.method === "PATCH" && adminTicketStatusMatch) {
			let body: AdminTicketStatusRequest;
			try {
				body = await request.json() as AdminTicketStatusRequest;
			} catch {
				return Response.json({ error: "Request body must be valid JSON" }, { status: 400 });
			}

			if (!body.status || !SUPPORT_TICKET_STATUSES.includes(body.status as SupportTicketStatus)) {
				return Response.json(
					{ error: "Invalid support ticket status" },
					{ status: 400 }
				);
			}

			try {
				const previousTicket = await getSupportTicket(
					Number(adminTicketStatusMatch[1]),
					env
				);
				const ticket = await updateSupportTicketStatus(
					Number(adminTicketStatusMatch[1]),
					body.status as SupportTicketStatus,
					env
				);
				await sendSupportTicketStatusNotification(previousTicket.status, ticket, env);

				return Response.json({
					ticket: {
						id: ticket.id,
						ticket_number: ticket.ticket_number,
						order_id: ticket.order_id,
						issue_type: ticket.issue_type,
						status: ticket.status,
						created_at: ticket.created_at,
					},
				});
			} catch (error) {
				if (error instanceof Error && error.message === "Support ticket not found") {
					return Response.json({ error: error.message }, { status: 404 });
				}

				if (error instanceof Error && error.message.startsWith("Unsupported support ticket status")) {
					return Response.json({ error: error.message }, { status: 400 });
				}

				console.error("Admin ticket status update failed:", error);
				return Response.json({ error: "Could not update support ticket status" }, { status: 500 });
			}
		}

		/*
		|--------------------------------------------------------------------------
		| Admin agent handoff API
		|--------------------------------------------------------------------------
		*/

		const adminAgentAcceptMatch = url.pathname.match(/^\/api\/admin\/agent-sessions\/(\d+)\/accept$/);
		const adminAgentReplyMatch = url.pathname.match(/^\/api\/admin\/agent-sessions\/(\d+)\/reply$/);
		const adminAgentEndMatch = url.pathname.match(/^\/api\/admin\/agent-sessions\/(\d+)\/end$/);
		const isAdminAgentRoute = Boolean(
			url.pathname === "/api/admin/agent-queue" ||
			adminAgentAcceptMatch ||
			adminAgentReplyMatch ||
			adminAgentEndMatch
		);

		if (isAdminAgentRoute && !env.ADMIN_API_TOKEN) {
			return Response.json({ error: "Admin API is not configured" }, { status: 503 });
		}

		if (isAdminAgentRoute && !isAdminRequest(request, env)) {
			return Response.json({ error: "Unauthorized" }, { status: 401 });
		}

		if (request.method === "GET" && url.pathname === "/api/admin/agent-queue") {
			try {
				const sessions = await getWaitingAgentSessions(env);
				const client = getAdminClient(env);

				const queue = await Promise.all(sessions.map(async (session) => {
					const ticket = await getSupportTicket(session.ticket_id, env);
					const messages = await getSupportMessages(ticket.id, env);
					const { data: images, error: imagesError } = await client
						.from("ticket_messages")
						.select("id, media_id, image_url, created_at")
						.eq("ticket_id", ticket.id)
						.eq("message_type", "IMAGE")
						.order("created_at", { ascending: false });

					if (imagesError) {
						console.error("Admin agent queue image lookup failed:", imagesError);
					}

					return {
						session_id: session.id,
						ticket_id: ticket.id,
						ticket_number: ticket.ticket_number,
						customer_phone: session.customer_phone,
						issue_type: ticket.issue_type,
						ticket_status: ticket.status,
						session_status: session.status,
						latest_messages: messages.slice(-5),
						images: images ?? [],
					};
				}));

				return Response.json({ queue });
			} catch (error) {
				console.error("Admin agent queue lookup failed:", error);
				return Response.json({ error: "Could not load agent queue" }, { status: 500 });
			}
		}

		if (request.method === "POST" && adminAgentAcceptMatch) {
			const sessionId = Number(adminAgentAcceptMatch[1]);
			let body: AgentAcceptRequest;
			try {
				body = await request.json() as AgentAcceptRequest;
			} catch {
				return Response.json({ error: "Request body must be valid JSON" }, { status: 400 });
			}

			const agentId = body.agentId?.trim();
			if (!agentId) {
				return Response.json({ error: "agentId is required" }, { status: 400 });
			}
			if (!isValidAgentId(agentId)) {
				return Response.json(
					{ error: "agentId must be a short identifier (name or code), not a message" },
					{ status: 400 }
				);
			}

			try {
				const accepted = await acceptSupportAgentSession(sessionId, agentId, env);
				if (!accepted) {
					return Response.json(
						{ error: "Session is no longer waiting (already accepted or closed)" },
						{ status: 409 }
					);
				}

				const ticket = await updateSupportTicketStatus(accepted.ticket_id, "IN_PROGRESS", env);

				console.log("[AGENT SESSION ACCEPTED]", {
					sessionId: accepted.id,
					ticketId: ticket.id,
					agentId,
				});

				return Response.json({ session: accepted, ticket });
			} catch (error) {
				console.error("Agent session accept failed:", error);
				return Response.json({ error: "Could not accept agent session" }, { status: 500 });
			}
		}

		if (request.method === "POST" && adminAgentReplyMatch) {
			const sessionId = Number(adminAgentReplyMatch[1]);
			let body: AgentReplyRequest;
			try {
				body = await request.json() as AgentReplyRequest;
			} catch {
				return Response.json({ error: "Request body must be valid JSON" }, { status: 400 });
			}

			const agentId = body.agentId?.trim();
			const replyMessage = body.message?.trim();
			if (!agentId) {
				return Response.json({ error: "agentId is required" }, { status: 400 });
			}
			if (!isValidAgentId(agentId)) {
				return Response.json(
					{ error: "agentId must be a short identifier (name or code), not a message" },
					{ status: 400 }
				);
			}
			if (!replyMessage) {
				return Response.json({ error: "message is required" }, { status: 400 });
			}

			try {
				const session = await getSupportAgentSession(sessionId, env);
				if (!session || session.status !== "ACTIVE") {
					return Response.json({ error: "No active agent session was found" }, { status: 409 });
				}

				if (session.agent_id !== agentId) {
					return Response.json({ error: "This session is assigned to a different agent" }, { status: 403 });
				}

				const ticket = await getSupportTicket(session.ticket_id, env);

				console.log("[AGENT MESSAGE SEND]", {
					sessionId: session.id,
					ticketId: ticket.id,
					agentId,
					customerPhone: ticket.customer_phone,
				});

				await sendWhatsAppMessage(
					ticket.customer_phone,
					[
						"Support Agent:",
						"",
						replyMessage,
					].join("\n"),
					env
				);

				const stored = await addSupportMessage(ticket.id, "AGENT", replyMessage, env, agentId);

				console.log("[AGENT MESSAGE SENT]", {
					sessionId: session.id,
					ticketId: ticket.id,
					agentId,
					customerPhone: ticket.customer_phone,
				});

				return Response.json({ message: stored });
			} catch (error) {
				if (error instanceof Error && error.message === "Support ticket not found") {
					return Response.json({ error: error.message }, { status: 404 });
				}

				console.error("Agent reply failed:", error);
				return Response.json({ error: "Could not send agent reply" }, { status: 500 });
			}
		}

		if (request.method === "POST" && adminAgentEndMatch) {
			const sessionId = Number(adminAgentEndMatch[1]);
			let body: AgentEndRequest;
			try {
				body = await request.json() as AgentEndRequest;
			} catch {
				return Response.json({ error: "Request body must be valid JSON" }, { status: 400 });
			}

			const agentId = body.agentId?.trim();
			if (!agentId) {
				return Response.json({ error: "agentId is required" }, { status: 400 });
			}
			if (!isValidAgentId(agentId)) {
				return Response.json(
					{ error: "agentId must be a short identifier (name or code), not a message" },
					{ status: 400 }
				);
			}

			try {
				const session = await getSupportAgentSession(sessionId, env);
				if (!session || session.status !== "ACTIVE") {
					return Response.json({ error: "No active agent session was found" }, { status: 409 });
				}

				if (session.agent_id !== agentId) {
					return Response.json({ error: "This session is assigned to a different agent" }, { status: 403 });
				}

				const closed = await closeSupportAgentSession(sessionId, env);
				const ticket = await updateSupportTicketStatus(session.ticket_id, "CLOSED", env);

				console.log("[AGENT SESSION CLOSED]", {
					sessionId: session.id,
					ticketId: ticket.id,
					agentId,
				});

				await sendWhatsAppMessage(
					ticket.customer_phone,
					[
						"Your conversation with the support agent has ended.",
						"",
						`Ticket: ${ticket.ticket_number}`,
						"",
						"If you need more help, you can start a new support request.",
					].join("\n"),
					env
				);

				return Response.json({ session: closed, ticket });
			} catch (error) {
				if (error instanceof Error && error.message === "Support ticket not found") {
					return Response.json({ error: error.message }, { status: 404 });
				}

				console.error("Agent session end failed:", error);
				return Response.json({ error: "Could not end agent session" }, { status: 500 });
			}
		}

		/*
		|--------------------------------------------------------------------------
		| Meta webhook verification
		|--------------------------------------------------------------------------
		*/

		if (
			request.method === "GET" &&
			url.pathname === "/webhook"
		) {
			console.log("[WEBHOOK GET] Verification request received");
			const mode =
				url.searchParams.get(
					"hub.mode"
				);

			const token =
				url.searchParams.get(
					"hub.verify_token"
				);

			const challenge =
				url.searchParams.get(
					"hub.challenge"
				);

			if (
				mode === "subscribe" &&
				token === VERIFY_TOKEN &&
				challenge
			) {
				console.log("[WEBHOOK GET] Verification succeeded");
				console.log("[RETURN] GET /webhook 200");
				return new Response(
					challenge,
					{ status: 200 }
				);
			}

			console.warn("[WEBHOOK GET] Verification failed", {
				mode,
				tokenMatched: token === VERIFY_TOKEN,
				hasChallenge: Boolean(challenge),
			});
			console.log("[RETURN] GET /webhook 403");
			return new Response(
				"Forbidden",
				{ status: 403 }
			);
		}

		/*
		|--------------------------------------------------------------------------
		| Razorpay webhook
		|--------------------------------------------------------------------------
		*/

		if (
			request.method === "POST" &&
			url.pathname ===
				"/razorpay-webhook"
		) {
			console.log("[ROUTE] POST /razorpay-webhook — webhook received");
			const rawBody = await request.text();
			const signature = request.headers.get("x-razorpay-signature") ?? "";
			console.log("[RAZORPAY WEBHOOK] has x-razorpay-signature header:", Boolean(request.headers.get("x-razorpay-signature")));
			const result = await handleRazorpaySuccessWebhook(rawBody, signature, env);
			console.log("[RETURN] POST /razorpay-webhook delegated", result);

			if (result.ok && result.orderId && result.customerPhone) {
				const delivery = await ensurePendingOrderDelivery(result.orderId, env);
				if (delivery.delivery_status === "PENDING_DETAILS") {
					if (delivery.customer_response === "NO") {
						await ensureDeliveryFollowUp(result.orderId, result.customerPhone, env);
					} else {
						const conversation = await getConversationState(result.customerPhone, env);
						const context = conversation?.context ?? {};
						const activeOrderId = Number(context.order_id);
						const isSameDeliveryConversation =
							conversation?.state === "DELIVERY_DETAILS" &&
							activeOrderId === result.orderId;

						if (!isSameDeliveryConversation) {
							if (
								conversation?.state === "DELIVERY_DETAILS" &&
								Number.isSafeInteger(activeOrderId) &&
								activeOrderId > 0
							) {
								const interruptedDelivery = await getOrderDeliveryDetails(activeOrderId, env);
								if (interruptedDelivery?.delivery_status === "PENDING_DETAILS") {
									await ensureDeliveryFollowUp(activeOrderId, result.customerPhone, env);
								}
							}
							const step = delivery.customer_response === "YES"
								? "ADDRESS_FORM"
								: "CHOICE";
							await upsertConversationState(
								result.customerPhone,
								"DELIVERY_DETAILS",
								env,
								{ source: "PAYMENT_SUCCESS_DELIVERY", order_id: result.orderId, step, delivery: {} },
								"payment_link.paid"
							);
							if (step === "CHOICE") {
								await sendDeliveryChoicePrompt(
									result.customerPhone,
									result.orderId,
									result.totalAmount ?? 0,
									env
								);
							} else {
								await sendAddressOptionsForOrder(result.customerPhone, result.orderId, env);
							}
						} else if (context.step === "CHOICE") {
							await sendDeliveryChoicePrompt(
								result.customerPhone,
								result.orderId,
								result.totalAmount ?? 0,
								env
							);
						}
					}
				} else if (!result.alreadyPaid) {
					await sendWhatsAppMessage(
						result.customerPhone,
						`✅ Payment received! Order #${result.orderId} is confirmed. Delivery details are already on file.`,
						env
					);
				}
			}

			return new Response(result.ok ? "Payment processed" : "Payment not processed", { status: result.ok ? 200 : 400 });
		}

		/*
		|--------------------------------------------------------------------------
		| WhatsApp webhook
		|--------------------------------------------------------------------------
		*/

		if (
			request.method === "POST" &&
			url.pathname === "/webhook"
		) {
			console.log("[WEBHOOK POST] Handler entered");

			let body: any;
			let rawBody: string;
			try {
				rawBody = await request.text();
				body = JSON.parse(rawBody);
			} catch (error) {
				console.error("[WEBHOOK POST] JSON parse failed:", error);
				console.log("[RETURN] POST /webhook 400");
				return new Response(
					"Invalid JSON",
					{ status: 400 }
				);
			}

			const hasDeliveryStatuses = (body.entry ?? [])
				.some((entry: any) => (entry.changes ?? [])
					.some((change: any) => (change.value?.statuses ?? []).length > 0));
			if (hasDeliveryStatuses) {
				if (!env.WHATSAPP_APP_SECRET) {
					console.error("[WHATSAPP_DELIVERY_STATUS_ERROR]", {
						error: "WHATSAPP_APP_SECRET is not configured; refusing unverified status callback",
					});
					return new Response("Webhook verification is not configured", { status: 503 });
				}
				const signature = request.headers.get("X-Hub-Signature-256") ?? "";
				const signatureValid = await verifyWhatsAppWebhookSignature(
					rawBody,
					signature,
					env.WHATSAPP_APP_SECRET
				);
				if (!signatureValid) {
					console.error("[WHATSAPP_DELIVERY_STATUS_ERROR]", {
						error: "Invalid X-Hub-Signature-256",
					});
					return new Response("Invalid webhook signature", { status: 401 });
				}
				await recordWhatsAppDeliveryStatuses(body, env);
			}

			const message =
				body.entry?.[0]
					?.changes?.[0]
					?.value
					?.messages?.[0];

			/*
			 * Sent, delivered and read status events
			 * do not contain messages[0].
			 */
			if (!message) {
				console.log("[WEBHOOK POST] No message; status event acknowledged");
				console.log("[RETURN] POST /webhook 200");
				return new Response(
					"EVENT_RECEIVED",
					{ status: 200 }
				);
			}

			const sender =
				String(message.from);

			const messageId =
				String(
					message.id ??
					crypto.randomUUID()
				);

			const incomingTextRaw = message.text?.body?.trim() ?? "";
			const incomingText = incomingTextRaw.toLowerCase();

			const buttonId =
				message.interactive
					?.button_reply
					?.id ?? "";

			const listRowId =
				message.interactive
					?.list_reply
					?.id ?? "";
			const flowResponseJson =
				message.interactive
					?.nfm_reply
					?.response_json;

			console.log(
				"Parsed WhatsApp input:",
				{
					sender: maskPhoneNumber(sender),
					hasText: Boolean(incomingTextRaw),
					textLength: incomingTextRaw.length,
					buttonId,
					listRowId,
				}
			);

			ctx.waitUntil(
				(async () => {
					try {
						if (typeof flowResponseJson === "string" &&
							await handleDeliveryFlowSubmission(sender, flowResponseJson, env, messageId)) {
							console.log("[WEBHOOK BRANCH RETURN] WhatsApp delivery address Flow");
							return;
						}

						if (await handleDeliveryConversation(sender, incomingTextRaw, buttonId, env, messageId)) {
							console.log("[WEBHOOK BRANCH RETURN] Delivery details conversation");
							return;
						}

						if (message.text?.body && await processWaitingAgentCustomerMessage(sender, incomingText, env)) {
							console.log("[WEBHOOK BRANCH RETURN] Waiting-agent customer message");
							return;
						}

							if (message.image) {
								const activeSession = await getActiveSupportSession(sender, env);
								const activeTicket = await getLatestCustomerSupportTicket(sender, env);
								const activeAgentSession = activeTicket
									? await getActiveOrWaitingAgentSessionForTicket(activeTicket.id, env)
									: null;
								if (activeSession && activeTicket && !activeAgentSession && ["DAMAGED_PRODUCT", "REPLACEMENT_REQUEST", "REFUND_REQUEST"].includes(activeSession.issue_type)) {
									if (!message.image.id) {
										console.error("[SUPPORT IMAGE] Missing media id for damaged product session");
										return;
									}

									await attachSupportSessionMedia(
										activeSession.id,
										message.image.id,
										message.image.url ?? null,
										message.image.mime_type ?? null,
										env
									);

									await updateSupportSession(
										activeSession.id,
										{
											status: "TICKET_CREATED",
											current_step: "WAITING_USER_DECISION",
											collected_data: {
												...(activeSession.collected_data ?? {}),
												image_id: message.image.id,
												image_url: message.image.url ?? null,
											},
										},
										env
									);

									console.log("[SUPPORT IMAGE ATTACHED]", {
										ticketId: activeTicket.id,
										ticketNumber: activeTicket.ticket_number,
										sessionId: activeSession.id,
									});

									if (activeSession.issue_type === "DAMAGED_PRODUCT") {
										const troubleshootingQuery = String(
											activeSession.issue_description ??
											(activeSession.collected_data as Record<string, unknown> | null)?.issue_description ??
											activeSession.product_name ??
											"damaged product"
										);
										const troubleshootingContext = await retrieveKnowledgeContext(troubleshootingQuery, env);
										const troubleshootingAnswer = await generateAnswerFromContext(troubleshootingQuery, troubleshootingContext, env);

										await sendDamagedProductResolutionCheck(
											sender,
											[
												"Thanks for the photo — here's something that might help:",
												"",
												troubleshootingAnswer,
												"",
												"Did this resolve the issue?",
											].join("\n"),
											env
										);
										console.log("[WEBHOOK BRANCH RETURN] Support image attached");
										return;
									}

									await sendPostImageSupportActions(sender, activeTicket.ticket_number, env);
										console.log("[SUPPORT POST IMAGE ACTIONS]", {
											ticketId: activeTicket.id,
											ticketNumber: activeTicket.ticket_number,
											phoneNumber: sender,
										});
									console.log("[WEBHOOK BRANCH RETURN] Support image attached");
									return;
								}

								const imageHandled = await processSupportImageMessage(
									sender,
									{
										id: message.image.id,
										url: message.image.url,
									},
									env
								);

								if (imageHandled) {
									console.log("[WEBHOOK BRANCH RETURN] Support image");
									return;
								}
							}

						/*
						| Welcome menu
						*/

						if (
							incomingText === "start" ||
							isGreetingOnly(incomingText)
						) {
							console.log("[WEBHOOK BRANCH] Main menu");
							await sendMainMenuButtons(
								sender,
								env
							);

							console.log("[WEBHOOK BRANCH RETURN] Main menu");
							return;
						}

						/*
						| Product list
						*/

						if (
							incomingText === "menu" ||
							buttonId ===
								"VIEW_PRODUCTS" ||
							buttonId ===
								"ADD_MORE_PRODUCTS"
						) {
							console.log("[WEBHOOK BRANCH] Product list");
							await upsertConversationState(
								sender,
								"BROWSING_PRODUCTS",
								env,
								{ source: "VIEW_PRODUCTS" },
								incomingText || buttonId || "menu"
							);
							await sendProductList(
								sender,
								env
							);

							console.log("[WEBHOOK BRANCH RETURN] Product list");
							return;
						}

						/*
						| Product selected from the list
						*/

						const selectedProductMatch =
							listRowId.match(
								/^ADD_PRODUCT_(\d+)$/
							);

						if (
							selectedProductMatch
						) {
							console.log("[WEBHOOK BRANCH] Product selection");
							const productId =
								Number(
									selectedProductMatch[1]
								);

							await upsertConversationState(
								sender,
								"BROWSING_PRODUCTS",
								env,
								{ product_id: productId },
								`ADD_PRODUCT_${productId}`
							);
							const addedCart =
								await addItemToCart(
									sender,
									productId,
									1,
									env
								);
							console.log(
								"Item added to cart:",
								{ productId, cartId: addedCart.id }
							);

							const { items } =
								await viewCart(sender, env);
							const addedItem = items.find(
								(item) => item.product_id === productId
							);
							await sendCartActions(
								sender,
								addedItem?.product_name ?? "Item",
								env
							);

							console.log("[WEBHOOK BRANCH RETURN] Product selection");
							return;
						}

						/*
						| Order selected from the list
						*/

						const selectedOrderMatch =
							listRowId.match(
								/^TRACK_ORDER_(\d+)$/
							);

						if (selectedOrderMatch) {
							console.log("[WEBHOOK BRANCH] Order selection");
							const selectedOrderId = Number(selectedOrderMatch[1]);

							await processTrackOrderById(
								sender,
								selectedOrderId,
								env
							);

							console.log("[WEBHOOK BRANCH RETURN] Order selection");
							return;
						}

						/*
						| View Cart
						*/

						if (
							buttonId ===
							"VIEW_CART" ||
							incomingText ===
								"cart"
						) {
							console.log("[WEBHOOK BRANCH] View cart");
							await upsertConversationState(
								sender,
								"VIEWING_CART",
								env,
								{ action: "VIEW_CART" },
								incomingText || buttonId || "cart"
							);
							const { items, total } = await viewCart(sender, env);
							const cartMessage = items.length
								? [
										"🛒 Your Cart",
										"",
										...items.map((item) => `${item.product_name}: ${item.quantity} × ₹${item.unit_price}`),
										"",
										`Total: ₹${total}`,
									].join("\n")
								: [
										"🛒 Your cart is empty.",
										"",
										"Select View Products to add an item.",
									].join("\n");
							await sendWhatsAppMessage(sender, cartMessage, env);

							console.log("[WEBHOOK BRANCH RETURN] View cart");
							return;
						}

						/*
						| Clear Cart
						*/

						if (
							buttonId ===
							"CLEAR_CART"
						) {
							console.log("[WEBHOOK BRANCH] Clear cart");
							await upsertConversationState(
								sender,
								"VIEWING_CART",
								env,
								{ action: "CLEAR_CART" },
								buttonId
							);
							await clearCommerceCart(sender, env);
							await sendWhatsAppMessage(
								sender,
								"🗑️ Your cart has been cleared. Select View Products to continue.",
								env
							);

							console.log("[WEBHOOK BRANCH RETURN] Clear cart");
							return;
						}

						/*
						| Checkout Cart
						*/

						if (
							buttonId ===
							"CHECKOUT_CART"
						) {
							console.log("[WEBHOOK BRANCH] Checkout cart");
							try {
								await startCheckoutAddressCollection(sender, messageId, env);
							} catch (error) {
								console.error("Commerce checkout failed:", error);
								await sendWhatsAppMessage(
									sender,
									"Checkout could not start. Please review your cart and try again.",
									env
								);
							}

							console.log("[WEBHOOK BRANCH RETURN] Checkout cart");
							return;
						}

						/*
						| Track Order (order selection list)
						*/

						if (
							buttonId ===
							"TRACK_ORDER"
						) {
							console.log("[WEBHOOK BRANCH] Order selection list");
							await upsertConversationState(
								sender,
								"TRACK_ORDER",
								env,
								{ source: "TRACK_ORDER" },
								buttonId
							);
							await sendOrderSelectionList(
								sender,
								env
							);

							console.log("[WEBHOOK BRANCH RETURN] Order selection list");
							return;
						}

						/*
						| Customer Care
						*/

							if (buttonId === "CUSTOMER_CARE") {
							console.log("[WEBHOOK BRANCH] Customer care");
							await upsertConversationState(
								sender,
								"CUSTOMER_CARE",
								env,
								{ source: "CUSTOMER_CARE" },
								buttonId
							);
							await processSupportRequest(
								sender,
								"customer support",
								env,
								"GENERAL_SUPPORT"
							);
							return;
							}

						if (buttonId === "TALK_AGENT") {
							await sendConnectAgentCta(sender, env);
							return;
						}

						if (buttonId === "CONNECT_AGENT") {
							await sendConnectAgentCta(sender, env);
							return;
						}

						if (buttonId === "ISSUE_RESOLVED") {
							const resolvedTicket = await getLatestCustomerSupportTicket(sender, env);
							const resolvedSession = await getLatestTicketCreatedSupportSession(sender, env);

							if (!resolvedTicket || !resolvedSession) {
								await sendWhatsAppMessage(sender, "No active support issue was found to resolve.", env);
								return;
							}

							await updateSupportSession(resolvedSession.id, { status: "CLOSED" }, env);
							const closedTicket = await updateSupportTicketStatus(resolvedTicket.id, "RESOLVED", env);

							console.log("[SUPPORT SELF RESOLVED]", {
								ticketId: closedTicket.id,
								ticketNumber: closedTicket.ticket_number,
								issueType: resolvedSession.issue_type,
							});

							await sendWhatsAppMessage(
								sender,
								[
									"✅ Great, glad that helped!",
									"",
									`Ticket ${closedTicket.ticket_number} has been marked resolved.`,
									"",
									"If you need anything else, just send a message.",
								].join("\n"),
								env
							);
							return;
						}

						if (buttonId === "TRACK_TICKET") {
							await processSupportTicketStatusRequest(sender, env);
							return;
						}

						if (buttonId === "CANCEL_REQUEST") {
							const ticket = await getLatestCustomerSupportTicket(sender, env);
							if (!ticket) {
								await sendWhatsAppMessage(sender, "No active support ticket was found.", env);
								return;
							}

							const closedTicket = await updateSupportTicketStatus(ticket.id, "CLOSED", env);
							await sendWhatsAppMessage(sender, `✅ Request cancelled. Ticket ${closedTicket.ticket_number} is closed.`, env);
							return;
						}

						if (buttonId === "END_CHAT") {
							const ticket = await getLatestCustomerSupportTicket(sender, env);
							const agentSession = ticket
								? await getActiveOrWaitingAgentSessionForTicket(ticket.id, env)
								: null;

							if (!ticket || !agentSession) {
								await sendWhatsAppMessage(sender, "No active support-agent chat was found.", env);
								return;
							}

							const previousSessionStatus = agentSession.status;
							await closeWaitingAgentTicket(
								sender,
								ticket,
								env,
								[
									"✅ Support chat ended",
									"",
									`Ticket: ${ticket.ticket_number}`,
									"",
									"Your conversation has been closed.",
									"",
									"If you need more help, you can start a new support request.",
								].join("\n")
							);

							console.log("[CUSTOMER END CHAT]", {
								sessionId: agentSession.id,
								ticketId: ticket.id,
								ticketNumber: ticket.ticket_number,
								previousSessionStatus,
							});
							return;
						}

						if (buttonId === "NO_THANKS") {
							await sendWhatsAppMessage(sender, "Understood. Your support ticket remains open.", env);
							return;
						}


						/*
						| Track a specific order
						*/

						const trackMatch =
							incomingText.match(
								/^track\s+#?(\d+)$/
							);

						if (trackMatch) {
							console.log("[WEBHOOK BRANCH] Track order by ID");
							const orderId =
								Number(
									trackMatch[1]
								);

							await processTrackOrderById(
								sender,
								orderId,
								env
							);

							console.log("[WEBHOOK BRANCH RETURN] Track order by ID");
							return;
						}

						/*
						| Order status intent (free text)
						*/

						const isOrderStatusIntent =
							(/\border\b/.test(incomingText) &&
								/\b(status|placed|where|track|arriving|arrived|delivered|shipped)\b/.test(
									incomingText
								)) ||
							(/\bpayment\b/.test(incomingText) &&
								/\b(received|status|done|complete|completed|successful|confirmed)\b/.test(
									incomingText
								));

						if (isOrderStatusIntent) {
							console.log("[WEBHOOK BRANCH] Order status intent");
							await upsertConversationState(
								sender,
								"TRACK_ORDER",
								env,
								{ source: "ORDER_STATUS_INTENT" },
								incomingText
							);
							await processLatestOrder(
								sender,
								env
							);

							console.log("[WEBHOOK BRANCH RETURN] Order status intent");
							return;
						}

						/*
						| Explicit ticket-append intent (only when the customer
						| clearly wants to add information to an existing
						| ticket — not merely because a ticket happens to be
						| OPEN, so commerce/order questions stay routable).
						*/

						if (incomingText && hasExplicitTicketAppendIntent(incomingText) && await processSupportTextMessage(sender, incomingText, env)) {
							console.log("[WEBHOOK BRANCH RETURN] Support text reply");
							return;
						}

						/*
						| Support ticket status intent
						*/

						if (isSupportStatusIntent(incomingText)) {
							console.log("[WEBHOOK BRANCH] Support ticket status");
							await upsertConversationState(
								sender,
								"CUSTOMER_CARE",
								env,
								{ source: "SUPPORT_TICKET_STATUS" },
								incomingText
							);
							await processSupportTicketStatusRequest(sender, env);

							console.log("[WEBHOOK BRANCH RETURN] Support ticket status");
							return;
						}

						if (incomingText && isSupportIntent(incomingText)) {
							const priorityIssueType = resolveSupportIssueType(incomingText);
							if (["DAMAGED_PRODUCT", "REPLACEMENT_REQUEST", "REFUND_REQUEST"].includes(priorityIssueType)) {
								await createImmediateSupportTicket(sender, incomingText, priorityIssueType, env);
								console.log("[WEBHOOK BRANCH RETURN] Support-priority ticket");
								return;
							}
						}

						if (incomingText && await getActiveSupportSession(sender, env)) {
							const activeSession = await getActiveSupportSession(sender, env);
							if (activeSession && activeSession.issue_type === "DAMAGED_PRODUCT") {
								const handled = await handleDamagedProductSupportConversation(sender, incomingText, env, activeSession);
								if (handled) {
									console.log("[WEBHOOK BRANCH RETURN] Damaged product session text");
									return;
								}
							}
						}

						if (incomingText && isNaturalAgentRequest(incomingText)) {
							await sendConnectAgentCta(sender, env);
							console.log("[WEBHOOK BRANCH RETURN] Natural-language agent handoff");
							return;
						}

						/*
						| Support ticket intent
						*/

						if (isSupportIntent(incomingText)) {
							const issueType = resolveSupportIssueType(incomingText);
							console.log("[SUPPORT INTENT DETECTED]", {
								message: incomingText,
								issueType,
							});
							console.log("[SUPPORT ISSUE TYPE]", issueType);

							if (
								issueType === "DAMAGED_PRODUCT" ||
								issueType === "REPLACEMENT_REQUEST" ||
								issueType === "REFUND_REQUEST"
							) {
								await createImmediateSupportTicket(sender, incomingText, issueType, env);
								console.log("[WEBHOOK BRANCH RETURN] Damaged product support session");
								return;
							}

							console.log("[WEBHOOK BRANCH] Support ticket");
							await upsertConversationState(
								sender,
								"CUSTOMER_CARE",
								env,
								{ source: "SUPPORT_TICKET", issue_type: issueType },
								incomingText
							);
							await processSupportRequest(sender, incomingText, env);

							console.log("[WEBHOOK BRANCH RETURN] Support ticket");
							return;
						}

						if (incomingText) {
							console.log("[AI COMMERCE ROUTER ENTRY]", {
								sender,
								message: incomingText,
							});
							const commerceReply = await answerCommerceQuestion(sender, incomingText, {
								AI: env.AI,
								SUPABASE_URL: env.SUPABASE_URL,
								SUPABASE_SERVICE_ROLE_KEY: env.SUPABASE_SERVICE_ROLE_KEY,
								SUPABASE_ANON_KEY: env.SUPABASE_ANON_KEY,
								OPENAI_API_KEY: env.OPENAI_API_KEY,
								OPENAI_CHAT_MODEL: env.OPENAI_CHAT_MODEL,
								RAG_MATCH_THRESHOLD: env.RAG_MATCH_THRESHOLD,
							});

							if (commerceReply) {
								await sendWhatsAppMessage(sender, commerceReply, env);
								console.log("[WEBHOOK BRANCH RETURN] AI commerce response");
								return;
							}

							console.log("[AI COMMERCE ROUTER SKIPPED]", {
								sender,
								reason: "UNKNOWN_COMMERCE_INTENT",
							});
						}

						/*
						| Legacy typed buy command
						*/

						const buyMatch =
							incomingText.match(
								/^buy\s+(\d+)$/
							);

						if (buyMatch) {
							console.log("[WEBHOOK BRANCH] Legacy buy command");
							const productId =
								Number(
									buyMatch[1]
								);

							await processBuyCommand(
								sender,
								messageId,
								productId,
								env
							);

							console.log("[WEBHOOK BRANCH RETURN] Legacy buy command");
							return;
						}

						/*
|--------------------------------------------------------------------------
| AI fallback for unknown text messages
|--------------------------------------------------------------------------
*/

if (incomingText) {
	console.log("[WEBHOOK BRANCH] RAG fallback");
	console.log(
		"Sending unknown text through RAG flow:",
		{
			sender,
			incomingText,
		}
	);

	const aiReply =
		await generateAnswer(
			incomingText,
			{
				AI: env.AI,
				SUPABASE_URL: env.SUPABASE_URL,
				SUPABASE_SERVICE_ROLE_KEY: env.SUPABASE_SERVICE_ROLE_KEY,
				SUPABASE_ANON_KEY: env.SUPABASE_ANON_KEY,
				OPENAI_API_KEY: env.OPENAI_API_KEY,
				OPENAI_CHAT_MODEL: env.OPENAI_CHAT_MODEL,
				RAG_MATCH_THRESHOLD: env.RAG_MATCH_THRESHOLD,
			}
		);

	await sendWhatsAppMessage(
		sender,
		aiReply,
		env
	);

	console.log(
		"RAG-based WhatsApp reply sent"
	);

	console.log("[WEBHOOK BRANCH RETURN] RAG fallback");
	return;
}

/*
|--------------------------------------------------------------------------
| Unsupported message type
|--------------------------------------------------------------------------
*/

await sendWhatsAppMessage(
	sender,
	[
		"I can currently understand text messages and menu selections.",
		"",
		"Send hi to open the main menu.",
	].join("\n"),
	env
);

						console.log("[WEBHOOK BRANCH] Unsupported message type");

						// await sendWhatsAppMessage(
						// 	sender,
						// 	[
						// 		"Sorry, I did not understand that message.",
						// 		"",
						// 		"Send hi to open the main menu.",
						// 		"Send menu to view products.",
						// 		"Send cart to view your cart.",
						// 		"Send track 5 to track order 5.",
						// 	].join("\n"),
						// 	env
						// );
					} catch (error) {
						console.error(
							"WhatsApp processing failed:",
							error
						);

						try {
							await sendWhatsAppMessage(
								sender,
								[
									"Sorry, something went wrong.",
									"",
									"Please try again shortly.",
								].join("\n"),
								env
							);
						} catch (
							fallbackError
						) {
							console.error(
								"Fallback message failed:",
								fallbackError
							);
						}
					}
				})()
			);

			console.log("[RETURN] POST /webhook 200");
			return new Response(
				"EVENT_RECEIVED",
				{ status: 200 }
			);
		}

		
    console.log("[RETURN] Unmatched route 200");
    return new Response(
      "WhatsApp commerce bot is running.",
      { status: 200 }
    );
}

let whatsappConfigDiagnosticsLogged = false;

export default {
  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext
  ): Promise<Response> {
    if (!whatsappConfigDiagnosticsLogged) {
      console.info("[WHATSAPP_CONFIG]", {
        hasPhoneNumberId: Boolean(env.PHONE_NUMBER_ID?.trim()),
        hasWhatsAppToken: Boolean(env.WHATSAPP_TOKEN?.trim()),
        hasAppSecret: Boolean(env.WHATSAPP_APP_SECRET?.trim()),
      });
      whatsappConfigDiagnosticsLogged = true;
    }

    const origin = request.headers.get("Origin");
    const allowedOrigins = [
      "http://localhost:5173",
    ];

    const corsHeaders = new Headers({
      "Access-Control-Allow-Methods":
        "GET, POST, PUT, PATCH, DELETE, OPTIONS",
      "Access-Control-Allow-Headers":
        "Content-Type, Authorization",
      "Vary": "Origin",
    });

    if (origin && allowedOrigins.includes(origin)) {
      corsHeaders.set(
        "Access-Control-Allow-Origin",
        origin
      );
    }

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: corsHeaders,
      });
    }

    const response = await handleRequest(
      request,
      env,
      ctx
    );

    const headers = new Headers(response.headers);
    corsHeaders.forEach((value, key) => {
      headers.set(key, value);
    });

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  },
} satisfies ExportedHandler<Env>;
