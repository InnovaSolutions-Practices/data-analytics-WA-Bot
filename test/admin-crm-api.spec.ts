import { beforeEach, describe, expect, it, vi } from "vitest";

type Customer = {
	id: number;
	name: string;
	whatsapp_number: string;
	email: string | null;
};

const db = vi.hoisted(() => ({
	customers: [] as Customer[],
	rpcResult: {
		order: { id: 81, customer_id: 7, status: "pending" },
		item: { id: 1, product_name: "Service Kit", quantity: 2 },
		delivery_address: { id: 10 },
	},
	rpc: vi.fn(),
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
	RAZORPAY_KEY_ID: "test-razorpay-key-id",
	RAZORPAY_KEY_SECRET: "test-razorpay-key-secret",
	RAZORPAY_WEBHOOK_SECRET: "test-razorpay-webhook-secret",
	OPENAI_API_KEY: "test-openai-key",
	ADMIN_API_TOKEN: adminToken,
};

function customerRequest(body: unknown, authorization = ["Bearer", adminToken].join(" ")) {
	return worker.fetch(
		new Request("https://worker.example.test/api/admin/customers", {
			method: "POST",
			headers: { Authorization: authorization, "Content-Type": "application/json" },
			body: JSON.stringify(body),
		}),
		env,
		{} as ExecutionContext
	);
}

function orderRequest(body: unknown, authorization = ["Bearer", adminToken].join(" ")) {
	return worker.fetch(
		new Request("https://worker.example.test/api/admin/customers/7/orders", {
			method: "POST",
			headers: { Authorization: authorization, "Content-Type": "application/json" },
			body: JSON.stringify(body),
		}),
		env,
		{} as ExecutionContext
	);
}

function makeQuery(table: string) {
	let inserted: Record<string, unknown> | null = null;
	const query: any = {};
	query.select = () => query;
	query.range = (from: number, to: number) => Promise.resolve({
		data: table === "customers" ? db.customers.slice(from, to + 1) : [],
		error: null,
	});
	query.insert = (value: Record<string, unknown>) => {
		inserted = value;
		return query;
	};
	query.single = async () => {
		if (table !== "customers" || !inserted) {
			return { data: null, error: { message: "Unexpected insert" } };
		}
		const customer = {
			id: db.customers.length + 1,
			...(inserted as Record<string, unknown>),
			created_at: "2026-10-30T00:00:00.000Z",
		} as Customer;
		db.customers.push(customer);
		return { data: customer, error: null };
	};
	return query;
}

beforeEach(() => {
	db.customers = [];
	db.rpc.mockReset();
	db.rpc.mockResolvedValue({ data: db.rpcResult, error: null });
	db.createClient.mockImplementation(() => ({
		from(table: string) {
			return makeQuery(table);
		},
		rpc: db.rpc,
	}));
});

describe("POST /api/admin/customers", () => {
	it("creates a persisted customer and normalizes a ten-digit Indian phone number", async () => {
		const response = await customerRequest({
			customer_name: "Robin",
			whatsapp_number: "8878787878",
			email: "robin@example.com",
		});

		expect(response.status).toBe(201);
		expect(await response.json()).toMatchObject({
			success: true,
			customer: {
				name: "Robin",
				whatsapp_number: "918878787878",
				email: "robin@example.com",
			},
		});
		expect(db.customers).toHaveLength(1);
	});

	it("rejects a phone number that already exists in another display format", async () => {
		db.customers = [{
			id: 5,
			name: "Existing",
			whatsapp_number: "+91 88787 87878",
			email: null,
		}];

		const response = await customerRequest({
			customer_name: "Robin",
			whatsapp_number: "8878787878",
		});

		expect(response.status).toBe(409);
		expect(db.customers).toHaveLength(1);
	});

	it("validates required fields and admin authorization", async () => {
		const missingName = await customerRequest({ whatsapp_number: "8878787878" });
		const unauthorized = await customerRequest(
			{ customer_name: "Robin", whatsapp_number: "8878787878" },
			"Bearer wrong-token"
		);

		expect(missingName.status).toBe(400);
		expect(unauthorized.status).toBe(401);
		expect(db.customers).toHaveLength(0);
	});
});

describe("POST /api/admin/customers/:id/orders", () => {
	it("creates the order aggregate through the transactional database function", async () => {
		const response = await orderRequest({
			product_id: 3,
			quantity: 2,
			unit_price: 150,
			notes: "Call before delivery",
			initial_status: "pending",
			delivery_address: {
				address_line_1: "12 Example Road",
				city: "Pune",
				state: "Maharashtra",
				pincode: "411001",
			},
		});

		expect(response.status).toBe(201);
		expect(await response.json()).toMatchObject({
			success: true,
			order: { id: 81, customer_id: 7, status: "pending" },
			item: { product_name: "Service Kit", quantity: 2 },
		});
		expect(db.rpc).toHaveBeenCalledWith("create_admin_order", {
			p_customer_id: 7,
			p_product_id: 3,
			p_quantity: 2,
			p_unit_price: 150,
			p_notes: "Call before delivery",
			p_delivery_address: {
				address_line_1: "12 Example Road",
				city: "Pune",
				state: "Maharashtra",
				pincode: "411001",
			},
			p_initial_status: "pending",
		});
	});

	it("rejects invalid quantities before calling the database", async () => {
		const response = await orderRequest({
			product_id: 3,
			quantity: 0,
			unit_price: 150,
			delivery_address: {
				address_line_1: "12 Example Road",
				city: "Pune",
				state: "Maharashtra",
				pincode: "411001",
			},
		});

		expect(response.status).toBe(400);
		expect(db.rpc).not.toHaveBeenCalled();
	});

	it("reports a missing database function as an actionable service-unavailable error", async () => {
		db.rpc.mockResolvedValueOnce({
			data: null,
			error: {
				code: "PGRST202",
				message: "Could not find the function public.create_admin_order in the schema cache",
			},
		});

		const response = await orderRequest({
			product_id: 3,
			quantity: 1,
			unit_price: 150,
			delivery_address: {
				address_line_1: "12 Example Road",
				city: "Pune",
				state: "Maharashtra",
				pincode: "411001",
			},
		});

		expect(response.status).toBe(503);
		expect(await response.json()).toMatchObject({
			success: false,
			error: expect.stringContaining("Apply supabase/migrations/016_admin_crm_orders.sql"),
		});
	});

	it("reports the required delivery-address profile column as an outdated-function error", async () => {
		db.rpc.mockResolvedValueOnce({
			data: null,
			error: {
				code: "23502",
				message: 'null value in column "profile_name" violates not-null constraint',
			},
		});

		const response = await orderRequest({
			product_id: 3,
			quantity: 1,
			unit_price: 150,
			delivery_address: {
				address_line_1: "12 Example Road",
				city: "Pune",
				state: "Maharashtra",
				pincode: "411001",
			},
		});

		expect(response.status).toBe(503);
		expect(await response.json()).toMatchObject({
			success: false,
			error: expect.stringContaining("017_fix_manual_order_delivery_address.sql"),
		});
	});
});
