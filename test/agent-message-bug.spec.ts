import { createExecutionContext, env, waitOnExecutionContext } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
	acceptSupportAgentSession,
	closeSupportAgentSession,
	createSupportAgentSession,
	createSupportTicket,
	getActiveOrWaitingAgentSessionForTicket,
	getAdminClient,
	getSupportTicket,
	updateSupportTicketStatus,
	type SupportTicketRecord,
} from "../src/commerce";
import { isValidAgentId } from "../src/index";
import worker from "../src";

/**
 * URGENT PRODUCTION BUG follow-up: a human agent typed a full sentence
 * ("how can i help you") into the dashboard's one-time "agent ID" setup
 * field instead of their actual identifier, and that value was faithfully
 * sent as `agentId` on the /accept call — the agent never actually clicked
 * Send afterwards, which is why no outgoing WhatsApp payload ever appeared.
 * There was no backend field-mapping bug and no wrong-endpoint call; the
 * fix is a server-side guard (isValidAgentId) rejecting message-shaped
 * agentId values on accept/reply/end, plus a clearer, validated setup form.
 */

const ADMIN_HEADERS = {
	Authorization: `Bearer ${env.ADMIN_API_TOKEN}`,
	"Content-Type": "application/json",
};

async function callAdminRoute(path: string, method: string, body?: unknown) {
	const request = new Request(`http://example.com${path}`, {
		method,
		headers: ADMIN_HEADERS,
		body: body ? JSON.stringify(body) : undefined,
	});
	const ctx = createExecutionContext();
	const response = await worker.fetch(request, env, ctx);
	await waitOnExecutionContext(ctx);
	const json = await response.json().catch(() => ({}));
	return { status: response.status, json };
}

describe("agentId must be an identifier, never message text (root cause + fix)", () => {
	it("B: 'how can i help you' is rejected as an agentId (it's message text)", () => {
		expect(isValidAgentId("how can i help you")).toBe(false);
	});

	it("legitimate short identifiers are accepted", () => {
		expect(isValidAgentId("Priya")).toBe(true);
		expect(isValidAgentId("Priya Singh")).toBe(true);
		expect(isValidAgentId("agent-042")).toBe(true);
		expect(isValidAgentId("priya@innova.com")).toBe(true);
	});

	it("other message-shaped strings are also rejected", () => {
		expect(isValidAgentId("Is your order still broken?")).toBe(false);
		expect(isValidAgentId("Thanks for waiting, checking now")).toBe(false);
	});
});

describe("Accept endpoint: identity validated, only performs the accept transition", () => {
	const createdTicketIds: number[] = [];

	afterEach(async () => {
		const client = getAdminClient(env);
		for (const id of createdTicketIds.splice(0)) {
			await client.from("support_tickets").delete().eq("id", id);
		}
	});

	async function makeWaitingSession(phone: string) {
		const ticket = await createSupportTicket({ customerPhone: phone, issueType: "GENERAL_SUPPORT" }, env);
		createdTicketIds.push(ticket.id);
		const session = await createSupportAgentSession(ticket.id, phone, env);
		await updateSupportTicketStatus(ticket.id, "WAITING_AGENT", env);
		return { ticket, session };
	}

	it("A: accepting with a valid agentId transitions session to ACTIVE and ticket to IN_PROGRESS", async () => {
		const phone = `+91accept${Date.now()}`.slice(0, 15);
		const { ticket, session } = await makeWaitingSession(phone);

		const { status, json } = await callAdminRoute(`/api/admin/agent-sessions/${session.id}/accept`, "POST", { agentId: "Priya" });

		expect(status).toBe(200);
		expect((json as any).session.status).toBe("ACTIVE");
		expect((json as any).session.agent_id).toBe("Priya");
		expect((json as any).ticket.status).toBe("IN_PROGRESS");

		const refreshedTicket = await getSupportTicket(ticket.id, env);
		expect(refreshedTicket.status).toBe("IN_PROGRESS");
	});

	it("rejects a message-shaped agentId on accept, and does NOT perform the transition", async () => {
		const phone = `+91badaccept${Date.now()}`.slice(0, 15);
		const { ticket, session } = await makeWaitingSession(phone);

		const { status, json } = await callAdminRoute(`/api/admin/agent-sessions/${session.id}/accept`, "POST", {
			agentId: "how can i help you",
		});

		expect(status).toBe(400);
		expect((json as any).error).toMatch(/short identifier/i);

		// Session must remain untouched — still WAITING_FOR_AGENT, ticket still WAITING_AGENT.
		const stillWaiting = await getActiveOrWaitingAgentSessionForTicket(ticket.id, env);
		expect(stillWaiting?.status).toBe("WAITING_FOR_AGENT");
		expect(stillWaiting?.agent_id).toBeNull();
		const refreshedTicket = await getSupportTicket(ticket.id, env);
		expect(refreshedTicket.status).toBe("WAITING_AGENT");
	});
});

describe("Agent send-message endpoint (existing /reply, reused and hardened)", () => {
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

	async function makeActiveSession(phone: string) {
		const ticket = await createSupportTicket({ customerPhone: phone, issueType: "GENERAL_SUPPORT" }, env);
		createdTicketIds.push(ticket.id);
		const session = await createSupportAgentSession(ticket.id, phone, env);
		await updateSupportTicketStatus(ticket.id, "WAITING_AGENT", env);
		await acceptSupportAgentSession(session.id, "Priya", env);
		await updateSupportTicketStatus(ticket.id, "IN_PROGRESS", env);
		return { ticket, session };
	}

	function whatsappCalls() {
		return fetchSpy.mock.calls.filter(([input]: any) => {
			const url = typeof input === "string" ? input : input?.url ?? String(input);
			return url.includes("graph.facebook.com");
		});
	}

	it("C: agent sends 'How can I help you?' — WhatsApp send called exactly once, to the right customer, body preserved", async () => {
		const phone = `+91reply${Date.now()}`.slice(0, 15);
		const { ticket, session } = await makeActiveSession(phone);

		const { status } = await callAdminRoute(`/api/admin/agent-sessions/${session.id}/reply`, "POST", {
			agentId: "Priya",
			message: "How can I help you?",
		});

		expect(status).toBe(200);
		const calls = whatsappCalls();
		expect(calls).toHaveLength(1);

		const [, init] = calls[0] as [unknown, RequestInit];
		const sentBody = JSON.parse(String(init.body));
		expect(sentBody.to).toBe(phone);
		expect(JSON.stringify(sentBody)).toContain("How can I help you?");

		const client = getAdminClient(env);
		const { data: messages } = await client.from("support_messages").select("*").eq("ticket_id", ticket.id);
		expect(messages).toHaveLength(1);
		expect(messages![0].sender_id).toBe("Priya");
		expect(messages![0].message_text).toBe("How can I help you?");
	});

	it("D: agent sends a message before the session is ACTIVE — rejected safely, no WhatsApp send", async () => {
		const phone = `+91notactive${Date.now()}`.slice(0, 15);
		const ticket = await createSupportTicket({ customerPhone: phone, issueType: "GENERAL_SUPPORT" }, env);
		createdTicketIds.push(ticket.id);
		const session = await createSupportAgentSession(ticket.id, phone, env);
		await updateSupportTicketStatus(ticket.id, "WAITING_AGENT", env);
		// Note: NOT accepted — still WAITING_FOR_AGENT.

		const { status, json } = await callAdminRoute(`/api/admin/agent-sessions/${session.id}/reply`, "POST", {
			agentId: "Priya",
			message: "How can I help you?",
		});

		expect(status).toBe(409);
		expect((json as any).error).toMatch(/no active agent session/i);
		expect(whatsappCalls()).toHaveLength(0);
	});

	it("G: agent End Chat closes the session and ticket per existing semantics", async () => {
		const phone = `+91agentend${Date.now()}`.slice(0, 15);
		const { ticket, session } = await makeActiveSession(phone);

		const { status, json } = await callAdminRoute(`/api/admin/agent-sessions/${session.id}/end`, "POST", { agentId: "Priya" });

		expect(status).toBe(200);
		expect((json as any).session.status).toBe("CLOSED");
		expect((json as any).ticket.status).toBe("CLOSED");

		const refreshedTicket = await getSupportTicket(ticket.id, env);
		expect(refreshedTicket.status).toBe("CLOSED");
		// The closing message is also sent via sendWhatsAppMessage — confirm exactly one WhatsApp call.
		expect(whatsappCalls()).toHaveLength(1);
	});
});

describe("Customer-side routing while ACTIVE (E) and customer END_CHAT (F) — unchanged, verified again for this task", () => {
	const createdTicketIds: number[] = [];

	afterEach(async () => {
		const client = getAdminClient(env);
		for (const id of createdTicketIds.splice(0)) {
			await client.from("support_tickets").delete().eq("id", id);
		}
	});

	it("E: while ACTIVE, the routing precondition (getActiveOrWaitingAgentSessionForTicket) is satisfied — same gate processWaitingAgentCustomerMessage/processSupportImageMessage use to bypass AI commerce/RAG/new-ticket creation", async () => {
		const phone = `+91activecust${Date.now()}`.slice(0, 15);
		const ticket: SupportTicketRecord = await createSupportTicket({ customerPhone: phone, issueType: "GENERAL_SUPPORT" }, env);
		createdTicketIds.push(ticket.id);
		const session = await createSupportAgentSession(ticket.id, phone, env);
		await updateSupportTicketStatus(ticket.id, "WAITING_AGENT", env);
		await acceptSupportAgentSession(session.id, "Priya", env);
		await updateSupportTicketStatus(ticket.id, "IN_PROGRESS", env);

		const found = await getActiveOrWaitingAgentSessionForTicket(ticket.id, env);
		expect(found?.status).toBe("ACTIVE");
	});

	it("F: customer END_CHAT closes the ACTIVE agent session and the ticket (same lifecycle verified in agent-end-chat.spec.ts)", async () => {
		const phone = `+91custend${Date.now()}`.slice(0, 15);
		const ticket = await createSupportTicket({ customerPhone: phone, issueType: "GENERAL_SUPPORT" }, env);
		createdTicketIds.push(ticket.id);
		const session = await createSupportAgentSession(ticket.id, phone, env);
		await updateSupportTicketStatus(ticket.id, "WAITING_AGENT", env);
		await acceptSupportAgentSession(session.id, "Priya", env);
		await updateSupportTicketStatus(ticket.id, "IN_PROGRESS", env);

		// This mirrors exactly what the customer END_CHAT button handler does.
		await closeSupportAgentSession(session.id, env);
		await updateSupportTicketStatus(ticket.id, "CLOSED", env);

		const refreshedTicket = await getSupportTicket(ticket.id, env);
		expect(refreshedTicket.status).toBe("CLOSED");
		const closedSession = await getActiveOrWaitingAgentSessionForTicket(ticket.id, env);
		expect(closedSession).toBeNull();
	});
});

// H: "the dashboard frontend uses agent_session.id, never ticket.id or
// support_session.id, for /agent-sessions/:id routes" is NOT covered by an
// automated test here — the @cloudflare/vitest-pool-workers sandbox runs
// against a virtual /bundle/ filesystem containing only the JS module graph,
// not arbitrary project files like public/agent.html, so readFileSync on it
// fails in this environment (confirmed empirically). This was instead
// verified by direct code reading: renderQueue() binds each Accept button via
// `acceptButton.addEventListener('click', () => acceptSession(item.session_id, acceptButton))`
// (public/agent.html), where item.session_id comes from GET /api/admin/agent-queue's
// `session_id: session.id` field (sourced from getWaitingAgentSessions(), a
// support_agent_sessions query) — never item.ticket_id. sendReply()/endChat()
// use `state.activeSessionId` (set from `data.session.id` on a successful
// accept), never `state.activeTicketId`. See the investigation report for the
// exact line citations.
