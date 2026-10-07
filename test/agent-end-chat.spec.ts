import { env } from "cloudflare:test";
import { afterEach, describe, expect, it } from "vitest";

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

/**
 * These tests exercise the real state-machine primitives that
 * startAgentHandoff() / the END_CHAT button handler / the agent-session
 * accept flow are built from (createSupportTicket, createSupportAgentSession,
 * acceptSupportAgentSession, closeSupportAgentSession,
 * getActiveOrWaitingAgentSessionForTicket, updateSupportTicketStatus),
 * against the real configured Supabase project — the same convention
 * test/index.spec.ts already uses via `cloudflare:test`'s `env`.
 *
 * They do not invoke the WhatsApp-sending index.ts orchestration functions
 * directly (startAgentHandoff, closeWaitingAgentTicket, the END_CHAT button
 * handler, processWaitingAgentCustomerMessage, processSupportImageMessage)
 * since those are private to index.ts and call the real WhatsApp Graph API;
 * this project's existing tests never mock network/Workers-runtime behavior,
 * and these tests follow that same convention. Every ticket created here is
 * deleted in afterEach (its support_agent_sessions row cascades on delete).
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

describe("agent-session end-chat lifecycle", () => {
	it("A: OPEN -> [startAgentHandoff's session-creation effect] -> WAITING_FOR_AGENT -> customer END_CHAT -> session CLOSED, ticket CLOSED", async () => {
		const ticket = await makeOpenTicket();
		expect(ticket.status).toBe("OPEN");

		// startAgentHandoff()'s core effect. NOTE: the CONNECT_AGENT button no
		// longer calls startAgentHandoff() as of the "Connect to Agent
		// WhatsApp CTA" feature (it now sends a direct-chat CTA instead) —
		// this test verifies the underlying agent-session lifecycle
		// primitives still work, which is what matters for this file's own
		// end-chat scenarios and for anything else that may still use them.
		const session = await createSupportAgentSession(ticket.id, ticket.customer_phone, env);
		const waitingTicket = await updateSupportTicketStatus(ticket.id, "WAITING_AGENT", env);
		expect(session.status).toBe("WAITING_FOR_AGENT");
		expect(waitingTicket.status).toBe("WAITING_AGENT");

		// customer END_CHAT: exactly what the button handler does
		const agentSession = await getActiveOrWaitingAgentSessionForTicket(ticket.id, env);
		expect(agentSession?.status).toBe("WAITING_FOR_AGENT");
		const closedSession = await closeSupportAgentSession(agentSession!.id, env);
		const closedTicket = await updateSupportTicketStatus(ticket.id, "CLOSED", env);

		expect(closedSession?.status).toBe("CLOSED");
		expect(closedTicket.status).toBe("CLOSED");
	});

	it("B: WAITING_FOR_AGENT -> agent accepts -> ACTIVE/IN_PROGRESS -> customer END_CHAT -> session CLOSED, ticket CLOSED", async () => {
		const ticket = await makeOpenTicket();
		await createSupportAgentSession(ticket.id, ticket.customer_phone, env);
		await updateSupportTicketStatus(ticket.id, "WAITING_AGENT", env);

		const waitingSession = await getActiveOrWaitingAgentSessionForTicket(ticket.id, env);

		// agent Accept Chat
		const accepted = await acceptSupportAgentSession(waitingSession!.id, "agent-1", env);
		const activeTicket = await updateSupportTicketStatus(ticket.id, "IN_PROGRESS", env);
		expect(accepted?.status).toBe("ACTIVE");
		expect(accepted?.agent_id).toBe("agent-1");
		expect(activeTicket.status).toBe("IN_PROGRESS");

		// customer END_CHAT while ACTIVE
		const agentSession = await getActiveOrWaitingAgentSessionForTicket(ticket.id, env);
		expect(agentSession?.status).toBe("ACTIVE");
		const closedSession = await closeSupportAgentSession(agentSession!.id, env);
		const closedTicket = await updateSupportTicketStatus(ticket.id, "CLOSED", env);

		expect(closedSession?.status).toBe("CLOSED");
		expect(closedTicket.status).toBe("CLOSED");
	});

	it("C: END_CHAT received twice -> no invalid transition, no duplicate session, no server error", async () => {
		const ticket = await makeOpenTicket();
		const session = await createSupportAgentSession(ticket.id, ticket.customer_phone, env);
		await updateSupportTicketStatus(ticket.id, "WAITING_AGENT", env);

		// first END_CHAT
		await closeSupportAgentSession(session.id, env);
		const firstClose = await updateSupportTicketStatus(ticket.id, "CLOSED", env);
		expect(firstClose.status).toBe("CLOSED");

		// second END_CHAT: getLatestCustomerSupportTicket-equivalent would no
		// longer find this ticket (CLOSED isn't an "active" status), but even
		// calling the close primitives directly a second time must not throw
		// or produce an invalid transition or a duplicate session row.
		await expect(closeSupportAgentSession(session.id, env)).resolves.toBeNull();
		await expect(updateSupportTicketStatus(ticket.id, "CLOSED", env)).resolves.toMatchObject({
			status: "CLOSED",
		});

		const finalTicket = await getSupportTicket(ticket.id, env);
		expect(finalTicket.status).toBe("CLOSED");

		const { data: sessions, error } = await getAdminClient(env)
			.from("support_agent_sessions")
			.select("id")
			.eq("ticket_id", ticket.id);
		expect(error).toBeNull();
		expect(sessions).toHaveLength(1);
	});

	it("D/E: getActiveOrWaitingAgentSessionForTicket gates ACTIVE-session routing (the precondition processWaitingAgentCustomerMessage/processSupportImageMessage rely on) and stops once CLOSED", async () => {
		const ticket = await makeOpenTicket();
		const session = await createSupportAgentSession(ticket.id, ticket.customer_phone, env);
		await updateSupportTicketStatus(ticket.id, "WAITING_AGENT", env);
		await acceptSupportAgentSession(session.id, "agent-1", env);
		await updateSupportTicketStatus(ticket.id, "IN_PROGRESS", env);

		// This is the exact call both processWaitingAgentCustomerMessage() and
		// processSupportImageMessage() make before logging [AGENT CUSTOMER
		// MESSAGE] / [AGENT CUSTOMER IMAGE] and skipping normal/AI routing.
		const activeSession = await getActiveOrWaitingAgentSessionForTicket(ticket.id, env);
		expect(activeSession).not.toBeNull();
		expect(activeSession?.status).toBe("ACTIVE");

		await closeSupportAgentSession(session.id, env);
		await updateSupportTicketStatus(ticket.id, "CLOSED", env);

		const afterClose = await getActiveOrWaitingAgentSessionForTicket(ticket.id, env);
		expect(afterClose).toBeNull();
	});
});
