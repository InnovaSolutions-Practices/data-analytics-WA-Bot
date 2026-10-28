import { beforeEach, describe, expect, it, vi } from "vitest";

type TestOrder = {
	id: number;
	customer_phone: string;
	created_at: string;
	total_amount: number;
};

const supabaseMock = vi.hoisted(() => ({
	rows: [] as TestOrder[],
	error: null as { message: string } | null,
	queries: [] as Array<{
		table: string;
		columns: string;
		column: string;
		value: string | number;
		orderBy: string | null;
		ascending: boolean | null;
		from: number | null;
		to: number | null;
	}>,
	createClient: vi.fn(),
}));

vi.mock("@supabase/supabase-js", () => ({
	createClient: supabaseMock.createClient,
}));

import worker from "../src";

const ADMIN_TOKEN = "test-admin-token";
const testEnv = {
	AI: Object.create(null) as Ai,
	SUPABASE_URL: "https://supabase.example.test",
	SUPABASE_ANON_KEY: "test-anon-key",
	SUPABASE_SERVICE_ROLE_KEY: "test-service-role-key",
	WHATSAPP_TOKEN: "test-whatsapp-token",
	PHONE_NUMBER_ID: "test-phone-number-id",
	RAZORPAY_KEY_ID: "test-razorpay-key-id",
	RAZORPAY_KEY_SECRET: "test-razorpay-key-secret",
	RAZORPAY_WEBHOOK_SECRET: "test-razorpay-webhook-secret",
	OPENAI_API_KEY: "test-openai-key",
	ADMIN_API_TOKEN: ADMIN_TOKEN,
};

function makeOrder(id: number, createdAt: string): TestOrder {
	return {
		id,
		customer_phone: "916280316170",
		created_at: createdAt,
		total_amount: id * 100,
	};
}

async function getCustomerOrders(phone: string, authorization?: string): Promise<Response> {
	const headers = new Headers();
	if (authorization) {
		headers.set("Authorization", authorization);
	}

	return worker.fetch(
		new Request(`https://example.com/api/admin/orders/customer/phone/${phone}`, {
			headers,
		}),
		testEnv,
		{} as ExecutionContext
	);
}

async function getOrderById(orderId: string, authorization?: string): Promise<Response> {
	const headers = new Headers();
	if (authorization) {
		headers.set("Authorization", authorization);
	}

	return worker.fetch(
		new Request(`https://example.com/api/admin/orders/${orderId}`, { headers }),
		testEnv,
		{} as ExecutionContext
	);
}

describe("GET /api/admin/orders/customer/phone/:phone", () => {
	beforeEach(() => {
		supabaseMock.rows = [];
		supabaseMock.error = null;
		supabaseMock.queries = [];
		supabaseMock.createClient.mockImplementation(() => ({
			from(table: string) {
				return {
					select(columns: string) {
						return {
							eq(column: string, phone: string) {
								return {
									order(orderBy: string, options: { ascending: boolean }) {
										return {
											range(from: number, to: number) {
												supabaseMock.queries.push({
													table,
													columns,
													column,
													value: phone,
													orderBy,
													ascending: options.ascending,
													from,
													to,
												});
												const rows = supabaseMock.rows
													.filter((row) => row.customer_phone === phone)
													.sort((a, b) => b.created_at.localeCompare(a.created_at))
													.slice(from, to + 1);
												return Promise.resolve({
													data: supabaseMock.error ? null : rows,
													error: supabaseMock.error,
												});
											},
										};
									},
								};
							},
						};
					},
				};
			},
		}));
	});

	it("returns all matching orders newest first for a customer with multiple orders", async () => {
		supabaseMock.rows = [
			makeOrder(1, "2026-01-01T10:00:00.000Z"),
			makeOrder(3, "2026-01-03T10:00:00.000Z"),
			makeOrder(2, "2026-01-02T10:00:00.000Z"),
		];

		const response = await getCustomerOrders("916280316170", `Bearer ${ADMIN_TOKEN}`);
		const body = await response.json() as {
			success: boolean;
			customerPhone: string;
			count: number;
			orders: TestOrder[];
		};

		expect(response.status).toBe(200);
		expect(body).toMatchObject({
			success: true,
			customerPhone: "916280316170",
			count: 3,
		});
		expect(body.orders.map((order) => order.id)).toEqual([3, 2, 1]);
		expect(supabaseMock.queries).toEqual([{
			table: "orders",
			columns: "*",
			column: "customer_phone",
			value: "916280316170",
			orderBy: "created_at",
			ascending: false,
			from: 0,
			to: 999,
		}]);
	});

	it("retrieves all matching orders across Supabase result pages", async () => {
		supabaseMock.rows = Array.from({ length: 1001 }, (_, id) =>
			makeOrder(id + 1, new Date(Date.UTC(2026, 0, 1, 0, 0, id)).toISOString())
		);

		const response = await getCustomerOrders("916280316170", `Bearer ${ADMIN_TOKEN}`);
		const body = await response.json() as { count: number; orders: TestOrder[] };

		expect(response.status).toBe(200);
		expect(body.count).toBe(1001);
		expect(body.orders[0]?.id).toBe(1001);
		expect(supabaseMock.queries.map(({ from, to }) => [from, to])).toEqual([
			[0, 999],
			[1000, 1999],
		]);
	});

	it("returns a single matching order", async () => {
		supabaseMock.rows = [makeOrder(7, "2026-02-01T10:00:00.000Z")];

		const response = await getCustomerOrders("916280316170", `Bearer ${ADMIN_TOKEN}`);
		const body = await response.json() as { count: number; orders: TestOrder[] };

		expect(response.status).toBe(200);
		expect(body.count).toBe(1);
		expect(body.orders.map((order) => order.id)).toEqual([7]);
	});

	it("returns an empty order list when the customer has no orders", async () => {
		const response = await getCustomerOrders("916280316170", `Bearer ${ADMIN_TOKEN}`);

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({
			success: true,
			customerPhone: "916280316170",
			count: 0,
			orders: [],
		});
	});

	it("normalizes phone formatting and rejects invalid phone numbers", async () => {
		const normalizedResponse = await getCustomerOrders("%2B91%206280-316170", `Bearer ${ADMIN_TOKEN}`);
		const invalidResponse = await getCustomerOrders("123", `Bearer ${ADMIN_TOKEN}`);

		expect(normalizedResponse.status).toBe(200);
		expect(supabaseMock.queries[0]?.value).toBe("916280316170");
		expect(invalidResponse.status).toBe(400);
		expect(supabaseMock.queries).toHaveLength(1);
	});

	it("returns a generic server error when Supabase fails", async () => {
		supabaseMock.error = { message: "database unavailable" };

		const response = await getCustomerOrders("916280316170", `Bearer ${ADMIN_TOKEN}`);

		expect(response.status).toBe(500);
		expect(await response.json()).toEqual({
			success: false,
			error: "Could not load customer orders",
		});
	});

	it("requires admin authorization", async () => {
		const response = await getCustomerOrders("916280316170");

		expect(response.status).toBe(401);
		expect(await response.json()).toEqual({ error: "Unauthorized" });
		expect(supabaseMock.queries).toHaveLength(0);
	});

	it("regression: keeps customer-phone orders routed to the phone lookup", async () => {
		supabaseMock.rows = [makeOrder(73, "2026-03-01T10:00:00.000Z")];

		const response = await getCustomerOrders("916280316170", `Bearer ${ADMIN_TOKEN}`);
		const body = await response.json() as { customerPhone: string; count: number; orders: TestOrder[] };

		expect(response.status).toBe(200);
		expect(body.customerPhone).toBe("916280316170");
		expect(body.count).toBe(1);
		expect(body.orders[0]?.id).toBe(73);
		expect(supabaseMock.queries[0]).toMatchObject({
			column: "customer_phone",
			value: "916280316170",
			orderBy: "created_at",
		});
	});
});

describe("GET /api/admin/orders/:orderId", () => {
	beforeEach(() => {
		supabaseMock.rows = [];
		supabaseMock.error = null;
		supabaseMock.queries = [];
		supabaseMock.createClient.mockImplementation(() => ({
			from(table: string) {
				return {
					select(columns: string) {
						return {
							eq(column: string, value: string | number) {
								return {
									maybeSingle() {
										supabaseMock.queries.push({
											table,
											columns,
											column,
											value,
											orderBy: null,
											ascending: null,
											from: null,
											to: null,
										});
										return Promise.resolve({
											data: supabaseMock.error
												? null
												: supabaseMock.rows.find((row) => row.id === value) ?? null,
											error: supabaseMock.error,
										});
									},
								};
							},
						};
					},
				};
			},
		}));
	});

	it("returns the requested order and queries the orders id column", async () => {
		const order = makeOrder(73, "2026-03-01T10:00:00.000Z");
		supabaseMock.rows = [order];

		const response = await getOrderById("73", `Bearer ${ADMIN_TOKEN}`);

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ success: true, order });
		expect(supabaseMock.queries).toEqual([{
			table: "orders",
			columns: "*",
			column: "id",
			value: 73,
			orderBy: null,
			ascending: null,
			from: null,
			to: null,
		}]);
	});

	it("returns 404 when the order does not exist", async () => {
		const response = await getOrderById("58", `Bearer ${ADMIN_TOKEN}`);

		expect(response.status).toBe(404);
		expect(await response.json()).toEqual({
			success: false,
			error: "Order not found",
		});
	});

	it.each(["not-a-number", "0", "-1", "1.5", "9007199254740992"])(
		"returns 400 for invalid order ID %s without querying Supabase",
		async (orderId) => {
			const response = await getOrderById(orderId, `Bearer ${ADMIN_TOKEN}`);

			expect(response.status).toBe(400);
			expect(await response.json()).toEqual({
				success: false,
				error: "Invalid order ID",
			});
			expect(supabaseMock.queries).toHaveLength(0);
		}
	);

	it("returns 500 when Supabase fails", async () => {
		supabaseMock.error = { message: "database unavailable" };

		const response = await getOrderById("21", `Bearer ${ADMIN_TOKEN}`);

		expect(response.status).toBe(500);
		expect(await response.json()).toEqual({
			success: false,
			error: "Could not load order",
		});
	});

	it.each([undefined, "Bearer incorrect-token"])(
		"requires valid admin authorization (%s)",
		async (authorization) => {
			const response = await getOrderById("73", authorization);

			expect(response.status).toBe(401);
			expect(await response.json()).toEqual({ error: "Unauthorized" });
			expect(supabaseMock.queries).toHaveLength(0);
		}
	);
});
