import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type TestOrder = {
	id: number;
	customer_id: number;
	customer_phone: string;
	status: string;
	created_at: string;
};

const db = vi.hoisted(() => ({
	order: {
		id: 42,
		customer_id: 7,
		customer_phone: "919876543210",
		status: "SHIPPED",
		created_at: "2026-01-01T00:00:00.000Z",
	},
	customer: {
		id: 7,
		name: "Asha",
		whatsapp_number: "919876543210",
	},
	history: [] as Array<Record<string, unknown>>,
	events: [] as Array<Record<string, any>>,
	createClient: vi.fn(),
}));

vi.mock("@supabase/supabase-js", () => ({
	createClient: db.createClient,
}));

import worker from "../src";

const adminToken = "test-admin-token";
const env = {
	AI: Object.create(null) as Ai,
	SUPABASE_URL: "https://supabase.example.test",
	SUPABASE_ANON_KEY: "test-anon-key",
	SUPABASE_SERVICE_ROLE_KEY: "test-service-role-key",
	WHATSAPP_TOKEN: "test-whatsapp-token",
	PHONE_NUMBER_ID: "test-phone-number-id",
	WHATSAPP_APP_SECRET: "test-whatsapp-app-secret",
	RAZORPAY_KEY_ID: "test-razorpay-key-id",
	RAZORPAY_KEY_SECRET: "test-razorpay-key-secret",
	RAZORPAY_WEBHOOK_SECRET: "test-razorpay-webhook-secret",
	OPENAI_API_KEY: "test-openai-key",
	ADMIN_API_TOKEN: adminToken,
};

function createQuery(table: string) {
	let operation = "select";
	let columns = "*";
	let values: Record<string, unknown> | null = null;
	const filters: Array<[string, unknown]> = [];
	const query: any = {};

	const matches = (row: Record<string, any>) =>
		filters.every(([column, value]) => {
			if (Array.isArray(value)) return value.includes(row[column]);
			if (value && typeof value === "object") {
				return Object.entries(value).every(
					([key, nestedValue]) => row[column]?.[key] === nestedValue
				);
			}
			return row[column] === value;
		});

	const resolve = () => {
		if (table === "orders") {
			if (operation === "update") {
				const matched = matches(db.order);
				if (matched) Object.assign(db.order, values);
				return { data: matched ? { ...db.order } : null, error: null };
			}
			if (columns.includes("customer:customers")) {
				return {
					data: [{ ...db.order, customer: db.customer }],
					error: null,
				};
			}
			return {
				data: matches(db.order) ? { ...db.order } : null,
				error: null,
			};
		}

		if (table === "customers") {
			return {
				data: matches(db.customer) ? { ...db.customer } : null,
				error: null,
			};
		}

		if (table === "order_status_history") {
			if (operation === "insert") {
				db.history.push(values ?? {});
				return { data: null, error: null };
			}
			return { data: db.history.filter(matches), error: null };
		}

		if (table === "notification_events") {
			if (operation === "insert") {
				db.events.push({ id: db.events.length + 1, ...(values ?? {}) });
				return { data: null, error: null };
			}
			if (operation === "update") {
				for (const event of db.events.filter(matches)) {
					Object.assign(event, values);
				}
				return { data: null, error: null };
			}
			const rows = db.events.filter(matches);
			return {
				data: rows.length ? { ...rows[rows.length - 1] } : null,
				error: null,
			};
		}

		return { data: null, error: null };
	};

	query.select = (selectedColumns: string) => {
		columns = selectedColumns;
		return query;
	};
	query.eq = (column: string, value: unknown) => {
		filters.push([column, value]);
		return query;
	};
	query.contains = (column: string, value: unknown) => {
		filters.push([column, value]);
		return query;
	};
	query.in = (column: string, valuesList: unknown[]) => {
		filters.push([column, valuesList]);
		return query;
	};
	query.order = () => query;
	query.range = () => query;
	query.limit = () => query;
	query.maybeSingle = async () => resolve();
	query.update = (updateValues: Record<string, unknown>) => {
		operation = "update";
		values = updateValues;
		return query;
	};
	query.insert = (insertValues: Record<string, unknown>) => {
		operation = "insert";
		values = insertValues;
		return query;
	};
	query.then = (
		onFulfilled?: (value: ReturnType<typeof resolve>) => unknown,
		onRejected?: (reason: unknown) => unknown
	) => Promise.resolve(resolve()).then(onFulfilled, onRejected);

	return query;
}

function statusRequest(status: string) {
	return worker.fetch(
		new Request("https://worker.example.test/api/admin/orders/42/status", {
			method: "POST",
			headers: {
				Authorization: `Bearer ${adminToken}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({ status }),
		}),
		env,
		{} as ExecutionContext
	);
}

function getOrdersRequest() {
	return worker.fetch(
		new Request("https://worker.example.test/api/admin/orders", {
			headers: { Authorization: `Bearer ${adminToken}` },
		}),
		env,
		{} as ExecutionContext
	);
}

async function signWebhookBody(body: string): Promise<string> {
	const key = await crypto.subtle.importKey(
		"raw",
		new TextEncoder().encode(env.WHATSAPP_APP_SECRET),
		{ name: "HMAC", hash: "SHA-256" },
		false,
		["sign"]
	);
	const digest = await crypto.subtle.sign(
		"HMAC",
		key,
		new TextEncoder().encode(body)
	);
	const hex = Array.from(new Uint8Array(digest))
		.map((byte) => byte.toString(16).padStart(2, "0"))
		.join("");
	return `sha256=${hex}`;
}

async function deliveryStatusWebhook(
	status: string,
	errors?: unknown,
	signatureOverride?: string
) {
	const body = JSON.stringify({
		entry: [{
			changes: [{
				value: {
					statuses: [{
						id: "wamid.test",
						status,
						recipient_id: "919876543210",
						timestamp: "1793320000",
						...(errors ? { errors } : {}),
					}],
				},
			}],
		}],
	});
	const signature = signatureOverride ?? await signWebhookBody(body);
	return worker.fetch(
		new Request("https://worker.example.test/webhook", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"X-Hub-Signature-256": signature,
			},
			body,
		}),
		env,
		{} as ExecutionContext
	);
}

beforeEach(() => {
	db.order.status = "SHIPPED";
	db.history = [];
	db.events = [];
	db.createClient.mockImplementation(() => ({
		from(table: string) {
			return createQuery(table);
		},
	}));
});

afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

describe("admin order status notifications", () => {
	it.each([
		{
			previousStatus: "payment_pending",
			status: "paid",
			messageType: "ORDER_PLACED",
			body: "Your order #42 has been placed successfully.",
			currentStatus: "Order placed",
		},
		{
			previousStatus: "paid",
			status: "PACKED",
			messageType: "PROCESSING",
			body: "Your order #42 is now being processed.",
			currentStatus: "Processing",
		},
		{
			previousStatus: "PACKED",
			status: "SHIPPED",
			messageType: "SHIPPED",
			body: "Your order #42 has been shipped.",
			currentStatus: "Shipped",
		},
		{
			previousStatus: "OUT_FOR_DELIVERY",
			status: "DELIVERED",
			messageType: "DELIVERED",
			body: "Your order #42 has been delivered.",
			currentStatus: "Delivered",
		},
		{
			previousStatus: "PACKED",
			status: "cancelled",
			messageType: "CANCELLED",
			body: "Your order #42 has been cancelled.",
			currentStatus: "Cancelled",
		},
	])("sends the $messageType status message", async ({
		previousStatus,
		status,
		messageType,
		body: template,
		currentStatus,
	}) => {
		db.order.status = previousStatus;
		let sentBody = "";
		vi.stubGlobal("fetch", async (_input: RequestInfo | URL, init?: RequestInit) => {
			const requestBody = JSON.parse(String(init?.body));
			sentBody = requestBody.text.body;
			return new Response(JSON.stringify({ messages: [{ id: "wamid.test" }] }), {
				status: 200,
			});
		});

		const response = await statusRequest(status);

		expect(response.status).toBe(200);
		expect(sentBody).toBe(
			`Hi Asha, ${template}\nCurrent status: ${currentStatus}.`
		);
		expect(db.events[0]?.payload).toMatchObject({ message_type: messageType });
	});

	it("includes the linked customer name in the admin order list", async () => {
		const response = await getOrdersRequest();
		const body = await response.json() as {
			orders: Array<TestOrder & { customer_name: string | null }>;
		};

		expect(response.status).toBe(200);
		expect(body.orders[0]?.customer_name).toBe("Asha");
	});

	it("resolves the customer, sends the status message, and marks the event sent", async () => {
		const responseLog = vi.spyOn(console, "log");
		const outgoingRequests: Array<{ url: string; body: Record<string, any> }> = [];
		vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
			outgoingRequests.push({
				url: String(input),
				body: JSON.parse(String(init?.body)),
			});
			return new Response(JSON.stringify({
				messaging_product: "whatsapp",
				contacts: [{ input: "919876543210", wa_id: "919876543210" }],
				messages: [{ id: "wamid.test" }],
			}), { status: 200 });
		});

		const response = await statusRequest("OUT_FOR_DELIVERY");
		const body = await response.json() as { order: TestOrder };

		expect(response.status).toBe(200);
		expect(body.order.status).toBe("OUT_FOR_DELIVERY");
		expect(db.history).toHaveLength(1);
		expect(db.events).toHaveLength(1);
		expect(db.events[0]).toMatchObject({
			status: "sent",
			customer_phone: "919876543210",
			related_status: "OUT_FOR_DELIVERY",
			payload: {
				customer_name: "Asha",
				previous_status: "SHIPPED",
				new_status: "OUT_FOR_DELIVERY",
				message_type: "OUT_FOR_DELIVERY",
			},
		});
		expect(outgoingRequests).toHaveLength(1);
		expect(outgoingRequests[0]?.url).toContain("/test-phone-number-id/messages");
		expect(outgoingRequests[0]?.body).toMatchObject({
			messaging_product: "whatsapp",
			to: "919876543210",
			type: "text",
			text: {
				body: [
					"Hi Asha, Your order #42 is out for delivery.",
					"Current status: Out for delivery.",
				].join("\n"),
			},
		});
		const metaLog = responseLog.mock.calls.find(
			([eventName]) => eventName === "[WHATSAPP_API_RESPONSE]"
		)?.[1];
		expect(metaLog).toMatchObject({
			endpoint: "https://graph.facebook.com/v21.0/test-phone-number-id/messages",
			httpStatus: 200,
			metaMessageId: "wamid.test",
			recipient: "********3210",
			payload: {
				messaging_product: "whatsapp",
				to: "********3210",
				type: "text",
				text: {
					body: "Hi <customer>, Your order #42 is out for delivery.\nCurrent status: Out for delivery.",
				},
			},
		});
		expect(JSON.stringify(metaLog)).not.toContain("919876543210");
		expect(JSON.stringify(metaLog)).not.toContain("Asha");
	});

	it("records Meta delivered and read callbacks without exposing the full recipient", async () => {
		db.order.status = "PACKED";
		vi.stubGlobal("fetch", async () =>
			new Response(JSON.stringify({ messages: [{ id: "wamid.test" }] }), { status: 200 })
		);
		await statusRequest("SHIPPED");
		const statusLog = vi.spyOn(console, "log");

		const deliveredResponse = await deliveryStatusWebhook("delivered");
		const readResponse = await deliveryStatusWebhook("read");
		const lateSentResponse = await deliveryStatusWebhook("sent");

		expect(deliveredResponse.status).toBe(200);
		expect(readResponse.status).toBe(200);
		expect(lateSentResponse.status).toBe(200);
		expect(db.events[0]).toMatchObject({
			status: "delivered",
			payload: {
				meta_message_id: "wamid.test",
				delivery_status: "read",
				delivery_status_timestamp: "1793320000",
			},
		});
		const deliveredLog = statusLog.mock.calls.find(
			([eventName, details]) =>
				eventName === "[WHATSAPP_DELIVERY_STATUS]" &&
				(details as Record<string, unknown>)?.status === "delivered"
		)?.[1];
		expect(deliveredLog).toMatchObject({
			metaMessageId: "wamid.test",
			status: "delivered",
			recipient: "********3210",
		});
		expect(JSON.stringify(deliveredLog)).not.toContain("919876543210");
	});

	it("records Meta failure details on the matched notification event", async () => {
		db.order.status = "PACKED";
		vi.stubGlobal("fetch", async () =>
			new Response(JSON.stringify({ messages: [{ id: "wamid.test" }] }), { status: 200 })
		);
		await statusRequest("SHIPPED");

		const response = await deliveryStatusWebhook("failed", [{
			code: 131026,
			title: "Message undeliverable",
			error_data: { details: "Recipient number 919876543210 is not reachable" },
		}]);

		expect(response.status).toBe(200);
		expect(db.events[0]).toMatchObject({
			status: "failed",
			payload: {
				delivery_status: "failed",
				delivery_errors: [{
					code: 131026,
					title: "Message undeliverable",
					error_data: { details: "Recipient number ********3210 is not reachable" },
				}],
			},
			reason: expect.stringContaining("131026"),
		});
	});

	it("rejects unsigned delivery callbacks without updating notification state", async () => {
		const response = await deliveryStatusWebhook("delivered", undefined, "sha256=invalid");

		expect(response.status).toBe(401);
		expect(db.events).toHaveLength(0);
	});

	it("keeps the status update successful when WhatsApp rejects the notification", async () => {
		vi.stubGlobal("fetch", async () =>
			new Response("WhatsApp unavailable", { status: 503 })
		);

		const response = await statusRequest("OUT_FOR_DELIVERY");
		const body = await response.json() as { order: TestOrder };

		expect(response.status).toBe(200);
		expect(body.order.status).toBe("OUT_FOR_DELIVERY");
		expect(db.events[0]?.status).toBe("failed");
		expect(db.events[0]?.reason).toContain('"httpStatus":503');
	});

	it("does not send a duplicate notification when the status is unchanged", async () => {
		let sendCount = 0;
		vi.stubGlobal("fetch", async () => {
			sendCount += 1;
			return new Response("unexpected", { status: 500 });
		});

		const response = await statusRequest("SHIPPED");

		expect(response.status).toBe(200);
		expect(sendCount).toBe(0);
		expect(db.events).toHaveLength(0);
	});
});
