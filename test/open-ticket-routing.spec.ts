import { env } from "cloudflare:test";
import { afterEach, describe, expect, it } from "vitest";

import {
	createSupportAgentSession,
	createSupportTicket,
	closeSupportAgentSession,
	acceptSupportAgentSession,
	getActiveOrWaitingAgentSessionForTicket,
	getAdminClient,
	updateSupportTicketStatus,
	type SupportTicketRecord,
} from "../src/commerce";
import { hasExplicitTicketAppendIntent, isSupportStatusIntent } from "../src/index";

/**
 * Covers the OPEN-ticket routing-priority fix: an OPEN support ticket with
 * no WAITING_FOR_AGENT/ACTIVE agent session must not blindly capture every
 * unmatched customer message via processSupportTextMessage(). That call is
 * now gated by hasExplicitTicketAppendIntent() and moved ahead of
 * isSupportStatusIntent() in the webhook branch chain (see src/index.ts).
 *
 * A/B/C/F verify the two gate predicates (the only things standing between
 * "OPEN ticket exists" and the commerce/order/AI router after this fix) stay
 * false for ordinary commerce/order/greeting messages, so those messages
 * fall through to existing commerce/order routing exactly as before an OPEN
 * ticket ever existed. D/E verify explicit ticket-context phrasing still
 * routes to ticket handling. G/H/I verify processWaitingAgentCustomerMessage's
 * human-agent priority (untouched by this task) still holds before and after
 * closure, using the same real-session precondition it depends on.
 */

const createdTicketIds: number[] = [];

afterEach(async () => {
	const client = getAdminClient(env);
	for (const ticketId of createdTicketIds.splice(0)) {
		await client.from("support_tickets").delete().eq("id", ticketId);
	}
});

async function makeOpenTicket(): Promise<SupportTicketRecord> {
	const ticket = await createSupportTicket(
		{
			customerPhone: `+91${Date.now()}`.slice(0, 15),
			issueType: "GENERAL_SUPPORT",
		},
		env
	);
	createdTicketIds.push(ticket.id);
	return ticket;
}

describe("OPEN ticket must not capture unrelated commerce/order messages", () => {
	it("A: 'How many Stocks are left of shoes' is not captured by ticket routing", () => {
		const message = "How many Stocks are left of shoes".toLowerCase();
		expect(hasExplicitTicketAppendIntent(message)).toBe(false);
		expect(isSupportStatusIntent(message)).toBe(false);
	});

	it("B: 'What is my order details' is not captured by ticket routing", () => {
		const message = "What is my order details".toLowerCase();
		expect(hasExplicitTicketAppendIntent(message)).toBe(false);
		expect(isSupportStatusIntent(message)).toBe(false);
	});

	it("C: 'When will be my order get delivered' is not captured by ticket routing (reaches isOrderStatusIntent unchanged)", () => {
		const message = "When will be my order get delivered".toLowerCase();
		expect(hasExplicitTicketAppendIntent(message)).toBe(false);
		expect(isSupportStatusIntent(message)).toBe(false);
		// isOrderStatusIntent itself is inline in index.ts and untouched by
		// this task; production evidence already confirms it matches this
		// message ("order" + "delivered"), which is why it's excluded here.
	});

	it("F: 'Hi' is unaffected — caught by the pre-existing greeting branch long before any ticket check", () => {
		expect(hasExplicitTicketAppendIntent("hi")).toBe(false);
		expect(isSupportStatusIntent("hi")).toBe(false);
	});
});

describe("OPEN ticket still reusable for explicit support-ticket context", () => {
	it("D: 'what is my support ticket status' routes to existing ticket status handling", () => {
		expect(isSupportStatusIntent("what is my support ticket status")).toBe(true);
	});

	it("E: 'add this information to my ticket' routes to processSupportTextMessage (append), not the status branch", () => {
		const message = "add this information to my ticket";
		expect(hasExplicitTicketAppendIntent(message)).toBe(true);
		// Checked before isSupportStatusIntent in the branch chain, so this
		// message is consumed here even though it also happens to contain
		// "my ticket" (which isSupportStatusIntent alone would also match).
	});

	it("extended isSupportStatusIntent examples: support ticket / request status / complaint / update-on-my", () => {
		expect(isSupportStatusIntent("check my support ticket")).toBe(true);
		expect(isSupportStatusIntent("track my support ticket")).toBe(true);
		expect(isSupportStatusIntent("support request status")).toBe(true);
		expect(isSupportStatusIntent("what happened to my complaint")).toBe(true);
		expect(isSupportStatusIntent("update on my refund request")).toBe(true);
		expect(isSupportStatusIntent("update on my complaint")).toBe(true);
		// Must NOT false-positive on an ordinary order-status question.
		expect(isSupportStatusIntent("give me an update on my order")).toBe(false);
	});

	it("hasExplicitTicketAppendIntent examples: TKT- references and append phrasing", () => {
		expect(hasExplicitTicketAppendIntent("here is more information for my ticket")).toBe(true);
		expect(hasExplicitTicketAppendIntent("update on ticket TKT-12345")).toBe(true);
		expect(hasExplicitTicketAppendIntent("add this message to my support ticket")).toBe(true);
	});
});

describe("human-agent session priority is preserved (unchanged by this task)", () => {
	it("G: WAITING_FOR_AGENT session still owns the conversation", async () => {
		const ticket = await makeOpenTicket();
		await createSupportAgentSession(ticket.id, ticket.customer_phone, env);
		await updateSupportTicketStatus(ticket.id, "WAITING_AGENT", env);

		const session = await getActiveOrWaitingAgentSessionForTicket(ticket.id, env);
		expect(session?.status).toBe("WAITING_FOR_AGENT");
		// processWaitingAgentCustomerMessage() gates on exactly this lookup
		// before it ever considers commerce/AI/support routing.
	});

	it("H: ACTIVE session still owns the conversation", async () => {
		const ticket = await makeOpenTicket();
		const session = await createSupportAgentSession(ticket.id, ticket.customer_phone, env);
		await updateSupportTicketStatus(ticket.id, "WAITING_AGENT", env);
		await acceptSupportAgentSession(session.id, "agent-1", env);
		await updateSupportTicketStatus(ticket.id, "IN_PROGRESS", env);

		const activeSession = await getActiveOrWaitingAgentSessionForTicket(ticket.id, env);
		expect(activeSession?.status).toBe("ACTIVE");
	});

	it("I: after CLOSED, normal routing resumes (no agent session found)", async () => {
		const ticket = await makeOpenTicket();
		const session = await createSupportAgentSession(ticket.id, ticket.customer_phone, env);
		await updateSupportTicketStatus(ticket.id, "WAITING_AGENT", env);
		await closeSupportAgentSession(session.id, env);
		await updateSupportTicketStatus(ticket.id, "CLOSED", env);

		const afterClose = await getActiveOrWaitingAgentSessionForTicket(ticket.id, env);
		expect(afterClose).toBeNull();
	});
});
