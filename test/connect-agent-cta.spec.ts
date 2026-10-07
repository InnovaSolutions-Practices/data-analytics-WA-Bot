import { createExecutionContext, env, waitOnExecutionContext } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createSupportTicket, getAdminClient, getSupportTicket } from "../src/commerce";
import worker, {
	buildAgentHandoffMessage,
	buildAgentWhatsAppUrl,
	normalizeWhatsAppNumber,
} from "../src/index";

/**
 * HUMAN AGENT HANDOFF via WhatsApp direct-chat CTA.
 *
 * Covers requirements 1-16 from the feature spec. Pure functions
 * (normalizeWhatsAppNumber, buildAgentWhatsAppUrl, buildAgentHandoffMessage)
 * are tested directly. The actual "Connect to Agent" send, and the
 * unmodified Track Ticket / Cancel Request buttons, are tested through the
 * real webhook entrypoint (worker.fetch, the same pattern test/index.spec.ts
 * already uses), with a fetch-spy intercepting only the outgoing WhatsApp
 * Graph API call so no real message is sent and no real token is needed.
 */

function whatsappWebhookPayload(from: string, buttonId: string) {
	return {
		entry: [
			{
				changes: [
					{
						value: {
							messages: [
								{
									from,
									id: `wamid.test.${Date.now()}`,
									interactive: {
										type: "button_reply",
										button_reply: { id: buttonId, title: buttonId },
									},
								},
							],
						},
					},
				],
			},
		],
	};
}

async function postWebhook(body: unknown) {
	const request = new Request("http://example.com/webhook", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(body),
	});
	const ctx = createExecutionContext();
	const response = await worker.fetch(request, env, ctx);
	await waitOnExecutionContext(ctx);
	return response;
}

describe("normalizeWhatsAppNumber", () => {
	it("1/2: strips separators and accepts a valid international number", () => {
		expect(normalizeWhatsAppNumber("+91 98765 43210")).toBe("919876543210");
		expect(normalizeWhatsAppNumber("919876543210")).toBe("919876543210");
	});

	it("7: missing configuration returns null (no broken CTA)", () => {
		expect(normalizeWhatsAppNumber(undefined)).toBeNull();
		expect(normalizeWhatsAppNumber(null)).toBeNull();
		expect(normalizeWhatsAppNumber("")).toBeNull();
	});

	it("8: invalid configuration (too short/too long/non-numeric) is rejected", () => {
		expect(normalizeWhatsAppNumber("123")).toBeNull();
		expect(normalizeWhatsAppNumber("1".repeat(20))).toBeNull();
		expect(normalizeWhatsAppNumber("not-a-number")).toBeNull();
	});
});

describe("buildAgentHandoffMessage", () => {
	it("4/5: includes ticket number and a human-readable issue label when available", () => {
		const message = buildAgentHandoffMessage({ ticket_number: "TKT-123", issue_type: "DAMAGED_PRODUCT" });
		expect(message).toContain("Ticket: #TKT-123");
		expect(message).toContain("Issue: Damaged Product");
	});

	it("falls back to generic wording when no ticket is available", () => {
		const message = buildAgentHandoffMessage(null);
		expect(message).toBe("Hi, I need help with my support request.");
		expect(message).not.toContain("Ticket:");
	});
});

describe("buildAgentWhatsAppUrl", () => {
	it("1/2/3: produces a wa.me URL with the configured number and URL-encoded text", () => {
		const url = buildAgentWhatsAppUrl("919876543210", "Hi, I need help.");
		expect(url).toBe("https://wa.me/919876543210?text=Hi%2C%20I%20need%20help.");
		expect(url.startsWith("https://wa.me/919876543210?text=")).toBe(true);
	});

	it("6: safely encodes spaces, &, #, %, ?, and line breaks", () => {
		const message = buildAgentHandoffMessage({ ticket_number: "TKT-1 & 2 #urgent 100% ready?", issue_type: "REFUND_REQUEST" });
		const url = buildAgentWhatsAppUrl("919876543210", message);

		// No raw special characters should ever appear unescaped in the query
		// string (% is excluded here since it's the escape marker itself and
		// legitimately appears throughout valid percent-encoded output).
		const query = url.split("?text=")[1];
		expect(query).not.toMatch(/[ &#?\n]/);
		expect(decodeURIComponent(query)).toBe(message);
		expect(message).toContain("\n");
	});

	it("11: the destination never contains anything resembling a credential", () => {
		const message = buildAgentHandoffMessage({ ticket_number: "TKT-999", issue_type: "REFUND_REQUEST" });
		const url = buildAgentWhatsAppUrl("919876543210", message);
		const forbidden = [env.WHATSAPP_TOKEN, env.SUPABASE_SERVICE_ROLE_KEY, env.OPENAI_API_KEY, env.RAZORPAY_KEY_SECRET, "Bearer", "token", "secret", "password"];
		for (const value of forbidden) {
			if (value) expect(url.toLowerCase()).not.toContain(String(value).toLowerCase());
		}
	});
});

describe("Connect to Agent — end-to-end via the real webhook", () => {
	const createdTicketIds: number[] = [];
	let fetchSpy: ReturnType<typeof vi.spyOn>;
	const realFetch = globalThis.fetch.bind(globalThis);

	beforeEach(() => {
		fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input: any, init?: any) => {
			const url = typeof input === "string" ? input : input?.url ?? String(input);
			if (url.includes("graph.facebook.com")) {
				return new Response(JSON.stringify({ messages: [{ id: "wamid.test" }] }), { status: 200 });
			}
			return realFetch(input, init);
		});
	});

	afterEach(async () => {
		fetchSpy.mockRestore();
		const client = getAdminClient(env);
		for (const id of createdTicketIds.splice(0)) {
			await client.from("support_tickets").delete().eq("id", id);
		}
	});

	function whatsappCalls() {
		return fetchSpy.mock.calls.filter(([input]: any) => {
			const url = typeof input === "string" ? input : input?.url ?? String(input);
			return url.includes("graph.facebook.com");
		});
	}

	it("9/10/11: CONNECT_AGENT sends exactly one CTA message with 'Connect to Agent' button text and no secrets in the URL", async () => {
		const phone = `91cta${Date.now()}`.slice(0, 15);
		const ticket = await createSupportTicket({ customerPhone: phone, issueType: "DAMAGED_PRODUCT" }, env);
		createdTicketIds.push(ticket.id);

		const response = await postWebhook(whatsappWebhookPayload(phone, "CONNECT_AGENT"));
		expect(response.status).toBe(200);

		const calls = whatsappCalls();
		expect(calls).toHaveLength(1);

		const [, init] = calls[0] as [unknown, RequestInit];
		const sentPayload = JSON.parse(String(init.body));

		expect(sentPayload.to).toBe(phone);
		expect(sentPayload.interactive.type).toBe("cta_url");
		expect(sentPayload.interactive.action.name).toBe("cta_url");
		expect(sentPayload.interactive.action.parameters.display_text).toBe("Connect to Agent");

		const ctaUrl: string = sentPayload.interactive.action.parameters.url;
		expect(ctaUrl.startsWith("https://wa.me/")).toBe(true);
		expect(ctaUrl).toContain(String(ticket.ticket_number));
		expect(ctaUrl.toLowerCase()).not.toContain(env.WHATSAPP_TOKEN?.toLowerCase() ?? "\u0000");
		expect(ctaUrl.toLowerCase()).not.toContain(env.SUPABASE_SERVICE_ROLE_KEY?.toLowerCase() ?? "\u0000");
		expect(JSON.stringify(sentPayload).toLowerCase()).not.toContain("bearer");

		// Ticket must NOT be closed/deleted/modified by Connect to Agent.
		const refreshed = await getSupportTicket(ticket.id, env);
		expect(refreshed.status).not.toBe("CLOSED");
	});

	it("7: CONNECT_AGENT with SUPPORT_WHATSAPP_NUMBER missing sends a safe fallback, not a broken CTA", async () => {
		const phone = `91nocfg${Date.now()}`.slice(0, 15);
		const brokenEnv = { ...env, SUPPORT_WHATSAPP_NUMBER: undefined };

		const request = new Request("http://example.com/webhook", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(whatsappWebhookPayload(phone, "CONNECT_AGENT")),
		});
		const ctx = createExecutionContext();
		const response = await worker.fetch(request, brokenEnv as typeof env, ctx);
		await waitOnExecutionContext(ctx);

		expect(response.status).toBe(200);
		const calls = whatsappCalls();
		expect(calls).toHaveLength(1);
		const [, init] = calls[0] as [unknown, RequestInit];
		const sentPayload = JSON.parse(String(init.body));
		// Fallback is a plain text message, not a broken/empty CTA.
		expect(sentPayload.type).toBe("text");
		expect(sentPayload.text.body).not.toContain("wa.me");
	});

	it("12: Track Ticket is unaffected by this change", async () => {
		const phone = `91track${Date.now()}`.slice(0, 15);
		const ticket = await createSupportTicket({ customerPhone: phone, issueType: "GENERAL_SUPPORT" }, env);
		createdTicketIds.push(ticket.id);

		const response = await postWebhook(whatsappWebhookPayload(phone, "TRACK_TICKET"));
		expect(response.status).toBe(200);

		const calls = whatsappCalls();
		expect(calls).toHaveLength(1);
		const [, init] = calls[0] as [unknown, RequestInit];
		const sentPayload = JSON.parse(String(init.body));
		expect(JSON.stringify(sentPayload)).toContain(ticket.ticket_number);
	});

	it("13: Cancel Request is unaffected by this change", async () => {
		const phone = `91cancel${Date.now()}`.slice(0, 15);
		const ticket = await createSupportTicket({ customerPhone: phone, issueType: "GENERAL_SUPPORT" }, env);
		createdTicketIds.push(ticket.id);

		const response = await postWebhook(whatsappWebhookPayload(phone, "CANCEL_REQUEST"));
		expect(response.status).toBe(200);

		const refreshed = await getSupportTicket(ticket.id, env);
		expect(refreshed.status).toBe("CLOSED");
	});

	it("16: webhook GET verification handshake still works", async () => {
		const request = new Request(
			"http://example.com/webhook?hub.mode=subscribe&hub.verify_token=whatsapp-bot-secret-123&hub.challenge=12345"
		);
		const ctx = createExecutionContext();
		const response = await worker.fetch(request, env, ctx);
		await waitOnExecutionContext(ctx);
		expect(response.status).toBe(200);
		expect(await response.text()).toBe("12345");
	});
});
