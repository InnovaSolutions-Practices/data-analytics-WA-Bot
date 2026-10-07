import { env } from "cloudflare:test";
import { afterEach, describe, expect, it } from "vitest";

import {
	acceptSupportAgentSession,
	attachSupportSessionMedia,
	createSupportAgentSession,
	createSupportSession,
	createSupportTicket,
	decrementProductStock,
	getActiveOrWaitingAgentSessionForTicket,
	getAdminClient,
	getLatestTicketCreatedSupportSession,
	handleRazorpaySuccessWebhook,
	updateSupportSession,
	updateSupportTicketStatus,
	type SupportTicketRecord,
} from "../src/commerce";
import { getInventory } from "../src/commerce-tools";

/**
 * PART A (bot-first support resolution) and PART B (inventory decrement).
 *
 * As with every other test in this project, functions that send real
 * WhatsApp messages (the ISSUE_RESOLVED/CONNECT_AGENT button handlers,
 * sendDamagedProductResolutionCheck) are private to index.ts and are not
 * invoked directly. Instead these tests exercise the exact underlying
 * commerce.ts state transitions those handlers perform, which is what
 * actually determines correctness (ticket/session status, agent-session
 * creation, inventory numbers).
 */

async function signRazorpayPayload(rawBody: string, secret: string): Promise<string> {
	const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
	const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody));
	return Array.from(new Uint8Array(signature)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

describe("PART A: damaged-product bot-first resolution", () => {
	const createdTicketIds: number[] = [];
	const createdSessionIds: number[] = [];

	afterEach(async () => {
		const client = getAdminClient(env);
		for (const id of createdTicketIds.splice(0)) {
			await client.from("support_tickets").delete().eq("id", id);
		}
		for (const id of createdSessionIds.splice(0)) {
			await client.from("support_sessions").delete().eq("id", id);
		}
	});

	async function makeOpenTicketAndSession(phone: string): Promise<{ ticket: SupportTicketRecord; sessionId: number }> {
		const ticket = await createSupportTicket({ customerPhone: phone, issueType: "DAMAGED_PRODUCT" }, env);
		createdTicketIds.push(ticket.id);
		const session = await createSupportSession(
			{ customerPhone: phone, issueType: "DAMAGED_PRODUCT", currentStep: "ASK_IMAGE", issueDescription: "the screen is cracked" },
			env
		);
		createdSessionIds.push(session.id);
		return { ticket, sessionId: session.id };
	}

	it("A: after image attach, the ticket is NOT escalated to WAITING_FOR_AGENT automatically", async () => {
		const phone = `+91support${Date.now()}`.slice(0, 15);
		const { ticket, sessionId } = await makeOpenTicketAndSession(phone);

		// Exactly what the DAMAGED_PRODUCT image branch does before presenting
		// the bot-resolution check (no attachSupportSessionMedia args validated
		// here — the point is the *status* transition, not the media row).
		await attachSupportSessionMedia(sessionId, "media-123", null, "image/jpeg", env);
		await updateSupportSession(sessionId, { status: "TICKET_CREATED", current_step: "WAITING_USER_DECISION" }, env);

		const agentSession = await getActiveOrWaitingAgentSessionForTicket(ticket.id, env);
		expect(agentSession).toBeNull(); // no agent session created — not escalated

		const refreshedTicket = await getAdminClient(env).from("support_tickets").select("status").eq("id", ticket.id).single();
		expect(refreshedTicket.data?.status).toBe("OPEN"); // unchanged, still just OPEN
	});

	it("B: ISSUE_RESOLVED closes the ticket and session cleanly without creating an agent session", async () => {
		const phone = `+91resolved${Date.now()}`.slice(0, 15);
		const { ticket, sessionId } = await makeOpenTicketAndSession(phone);
		await updateSupportSession(sessionId, { status: "TICKET_CREATED", current_step: "WAITING_USER_DECISION" }, env);

		// Exactly what the ISSUE_RESOLVED button handler does.
		const foundSession = await getLatestTicketCreatedSupportSession(phone, env);
		expect(foundSession?.id).toBe(sessionId);

		await updateSupportSession(foundSession!.id, { status: "CLOSED" }, env);
		const resolvedTicket = await updateSupportTicketStatus(ticket.id, "RESOLVED", env);

		expect(resolvedTicket.status).toBe("RESOLVED");
		const { data: sessionRow } = await getAdminClient(env).from("support_sessions").select("status").eq("id", sessionId).single();
		expect(sessionRow?.status).toBe("CLOSED");

		const agentSession = await getActiveOrWaitingAgentSessionForTicket(ticket.id, env);
		expect(agentSession).toBeNull(); // no agent session was ever created
	});

	it("C: the underlying agent-handoff primitives still work after the bot-resolution stage (ticket was still OPEN)", async () => {
		const phone = `+91escalate${Date.now()}`.slice(0, 15);
		const { ticket } = await makeOpenTicketAndSession(phone);

		// This is exactly startAgentHandoff()'s own logic. NOTE: as of the
		// later "Connect to Agent WhatsApp CTA" feature, the CONNECT_AGENT
		// button itself no longer calls startAgentHandoff() — it now sends a
		// direct-WhatsApp-chat CTA instead (see sendConnectAgentCta in
		// index.ts). startAgentHandoff() and these commerce.ts primitives are
		// kept intact/unused per that feature's explicit instructions not to
		// delete the agent-session implementation; this test just confirms
		// they still function correctly (OPEN status survives the
		// troubleshooting stage), not that the button still triggers them.
		const session = await createSupportAgentSession(ticket.id, phone, env);
		const waitingTicket = await updateSupportTicketStatus(ticket.id, "WAITING_AGENT", env);

		expect(session.status).toBe("WAITING_FOR_AGENT");
		expect(waitingTicket.status).toBe("WAITING_AGENT");
	});

	it("D: after agent accepts (ACTIVE), the existing ACTIVE routing precondition is unchanged", async () => {
		const phone = `+91active${Date.now()}`.slice(0, 15);
		const { ticket } = await makeOpenTicketAndSession(phone);
		const session = await createSupportAgentSession(ticket.id, phone, env);
		await updateSupportTicketStatus(ticket.id, "WAITING_AGENT", env);
		await acceptSupportAgentSession(session.id, "agent-1", env);
		await updateSupportTicketStatus(ticket.id, "IN_PROGRESS", env);

		const activeSession = await getActiveOrWaitingAgentSessionForTicket(ticket.id, env);
		expect(activeSession?.status).toBe("ACTIVE");
		// This is the exact precondition processWaitingAgentCustomerMessage()
		// and processSupportImageMessage() already gate on (verified in
		// agent-end-chat.spec.ts / open-ticket-routing.spec.ts) — unchanged.
	});
});

describe("PART B: inventory decrement", () => {
	const createdProductIds: number[] = [];
	const createdOrderIds: number[] = [];

	afterEach(async () => {
		const client = getAdminClient(env);
		for (const id of createdOrderIds.splice(0)) {
			await client.from("orders").delete().eq("id", id);
		}
		for (const id of createdProductIds.splice(0)) {
			await client.from("products").delete().eq("id", id);
		}
	});

	async function makeProduct(stock: number): Promise<{ id: number; name: string }> {
		const client = getAdminClient(env);
		const name = `Inventory Test Product ${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
		const { data, error } = await client.from("products").insert({ name, price: 100, stock, is_active: true }).select("id, name").single();
		if (error || !data) throw new Error(`test product creation failed: ${error?.message}`);
		createdProductIds.push(data.id);
		return data;
	}

	async function getStock(productId: number): Promise<number> {
		const { data } = await getAdminClient(env).from("products").select("stock").eq("id", productId).single();
		return Number(data?.stock);
	}

	it("E: quantity 1 purchase decreases stock by 1", async () => {
		const product = await makeProduct(10);
		await decrementProductStock(product.id, 1, env);
		expect(await getStock(product.id)).toBe(9);
	});

	it("F: quantity > 1 decreases stock by the purchased quantity", async () => {
		const product = await makeProduct(10);
		await decrementProductStock(product.id, 3, env);
		expect(await getStock(product.id)).toBe(7);
	});

	it("G: multi-product order decrements each product correctly", async () => {
		const shoes = await makeProduct(10);
		const bag = await makeProduct(5);
		await decrementProductStock(shoes.id, 2, env);
		await decrementProductStock(bag.id, 1, env);
		expect(await getStock(shoes.id)).toBe(8);
		expect(await getStock(bag.id)).toBe(4);
	});

	it("J: stock cannot become negative", async () => {
		const product = await makeProduct(2);
		await decrementProductStock(product.id, 5, env);
		expect(await getStock(product.id)).toBe(0);
	});

	it("K: getInventory reflects the post-purchase stock (not hardcoded)", async () => {
		const product = await makeProduct(10);
		await decrementProductStock(product.id, 1, env);

		const result = await getInventory(product.name, env);
		expect(result.found).toBe(true);
		expect(result.data?.stock).toBe(9);
	});

	it("H/I: a real payment_link.paid webhook decrements inventory exactly once; a duplicate delivery does not decrement again; a non-success event never decrements", async () => {
		const product = await makeProduct(10);
		const client = getAdminClient(env);
		const linkId = `plink_test_${Date.now()}`;

		const { data: order, error } = await client
			.from("orders")
			.insert({
				customer_phone: `+91webhook${Date.now()}`.slice(0, 15),
				status: "payment_pending",
				subtotal: 200,
				tax: 0,
				total_amount: 200,
				currency: "INR",
				payment_provider: "razorpay",
				razorpay_payment_link_id: linkId,
			})
			.select("id")
			.single();
		if (error || !order) throw new Error(`test order creation failed: ${error?.message}`);
		createdOrderIds.push(order.id);

		await client.from("order_items").insert({
			order_id: order.id,
			product_id: product.id,
			product_name: product.name,
			unit_price: 100,
			quantity: 2,
			line_total: 200,
		});

		const paidPayload = JSON.stringify({
			event: "payment_link.paid",
			payload: {
				payment_link: { entity: { id: linkId } },
				payment: { entity: { id: "pay_test_123" } },
			},
		});
		const paidSignature = await signRazorpayPayload(paidPayload, env.RAZORPAY_WEBHOOK_SECRET);

		// I: a non-success event must never decrement inventory.
		const capturedPayload = JSON.stringify({ event: "payment.captured", payload: {} });
		const capturedSignature = await signRazorpayPayload(capturedPayload, env.RAZORPAY_WEBHOOK_SECRET);
		await handleRazorpaySuccessWebhook(capturedPayload, capturedSignature, env);
		expect(await getStock(product.id)).toBe(10);

		// First (real) delivery of payment_link.paid: decrements exactly once.
		const first = await handleRazorpaySuccessWebhook(paidPayload, paidSignature, env);
		expect(first.ok).toBe(true);
		expect(await getStock(product.id)).toBe(8);

		// H: duplicate delivery of the same event must not decrement again.
		const second = await handleRazorpaySuccessWebhook(paidPayload, paidSignature, env);
		expect(second.ok).toBe(true);
		expect(await getStock(product.id)).toBe(8);
	}, 30000);
});
