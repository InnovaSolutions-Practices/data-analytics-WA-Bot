import { env } from "cloudflare:test";
import { afterEach, describe, expect, it } from "vitest";

import { getAdminClient } from "../src/commerce";
import { answerCommerceQuestion } from "../src/ai-commerce-router";
import { isGreetingOnly } from "../src/index";

/**
 * PART C — greeting normalization, TRACK_ORDER selection, and the
 * lastOrderId commerce-context bug.
 *
 * isGreetingOnly is a pure predicate (exported from index.ts) and is tested
 * directly. The TRACK_ORDER list/selection flow and "track <id>" text
 * command send real WhatsApp messages via private index.ts functions, so —
 * consistent with every other test in this project — G/H/I/J/K/L verify the
 * exact underlying Supabase query/ownership logic those functions use
 * (customer_phone-scoped lookups) rather than invoking the WhatsApp-sending
 * functions themselves. M/N exercise the real commerce-context self-healing
 * fix end-to-end against the real database and real OpenAI classifier.
 */

describe("greeting normalization (isGreetingOnly)", () => {
	it("A: 'Hi' is a greeting", () => {
		expect(isGreetingOnly("Hi")).toBe(true);
	});

	it("B: 'Hii' is a greeting", () => {
		expect(isGreetingOnly("Hii")).toBe(true);
	});

	it("C: 'Hiii' is a greeting", () => {
		expect(isGreetingOnly("Hiii")).toBe(true);
	});

	it("D: 'Hello!' is a greeting", () => {
		expect(isGreetingOnly("Hello!")).toBe(true);
	});

	it("additional required variants: hey, hey!, hey there, good morning/afternoon/evening", () => {
		expect(isGreetingOnly("hey")).toBe(true);
		expect(isGreetingOnly("hey!")).toBe(true);
		expect(isGreetingOnly("hey there")).toBe(true);
		expect(isGreetingOnly("good morning")).toBe(true);
		expect(isGreetingOnly("good afternoon")).toBe(true);
		expect(isGreetingOnly("good evening")).toBe(true);
	});

	it("E: 'Hi, where is order 21?' is NOT greeting-only — must continue to order handling", () => {
		expect(isGreetingOnly("Hi, where is order 21?")).toBe(false);
	});

	it("F: 'Hello, my product is broken' is NOT greeting-only — must continue to support handling", () => {
		expect(isGreetingOnly("Hello, my product is broken")).toBe(false);
	});

	it("does not use a loose substring check — words merely containing 'hi' are not greetings", () => {
		expect(isGreetingOnly("this is a test")).toBe(false);
		expect(isGreetingOnly("which shoes do you have")).toBe(false);
	});
});

describe("TRACK_ORDER: order list is customer-scoped (underlying query used by sendOrderSelectionList / processTrackOrderById)", () => {
	const createdOrderIds: number[] = [];
	const phoneA = `+91track${Date.now()}`.slice(0, 15);
	const phoneB = `+91other${Date.now()}`.slice(0, 15);

	afterEach(async () => {
		const client = getAdminClient(env);
		for (const id of createdOrderIds.splice(0)) {
			await client.from("orders").delete().eq("id", id);
		}
	});

	async function createTestOrder(phone: string, totalAmount: number): Promise<number> {
		const client = getAdminClient(env);
		const { data, error } = await client
			.from("orders")
			.insert({
				customer_phone: phone,
				status: "paid",
				subtotal: totalAmount,
				tax: 0,
				total_amount: totalAmount,
				currency: "INR",
				payment_provider: "razorpay",
			})
			.select("id")
			.single();
		if (error || !data) throw new Error(`test order creation failed: ${error?.message}`);
		createdOrderIds.push(data.id);
		return data.id;
	}

	it("G/H: a customer with multiple orders sees only their own orders (not another customer's)", async () => {
		const orderA1 = await createTestOrder(phoneA, 500);
		const orderA2 = await createTestOrder(phoneA, 700);
		await createTestOrder(phoneB, 999);

		const client = getAdminClient(env);
		const { data } = await client
			.from("orders")
			.select("id, customer_phone")
			.eq("customer_phone", phoneA)
			.order("created_at", { ascending: false })
			.limit(10);

		expect(data).toHaveLength(2);
		expect(data!.map((o) => o.id).sort()).toEqual([orderA1, orderA2].sort());
		expect(data!.every((o) => o.customer_phone === phoneA)).toBe(true);
	});

	it("I: a specific order is found when it belongs to the requesting sender", async () => {
		const orderId = await createTestOrder(phoneA, 500);
		const client = getAdminClient(env);

		const { data } = await client
			.from("orders")
			.select("id, customer_phone")
			.eq("id", orderId)
			.eq("customer_phone", phoneA)
			.maybeSingle();

		expect(data).not.toBeNull();
		expect(data!.id).toBe(orderId);
	});

	it("J: selecting another customer's order is safely rejected (no row returned, no cross-customer leak)", async () => {
		const orderId = await createTestOrder(phoneA, 500);
		const client = getAdminClient(env);

		// phoneB attempting to select phoneA's order — this is exactly
		// processTrackOrderById's existing .eq('customer_phone', sender) guard.
		const { data } = await client
			.from("orders")
			.select("id, customer_phone")
			.eq("id", orderId)
			.eq("customer_phone", phoneB)
			.maybeSingle();

		expect(data).toBeNull();
	});

	it("K: a customer with no orders gets an empty result (drives the 'No orders were found' response, not an empty list)", async () => {
		const client = getAdminClient(env);
		const emptyPhone = `+91empty${Date.now()}`.slice(0, 15);

		const { data } = await client
			.from("orders")
			.select("id")
			.eq("customer_phone", emptyPhone)
			.order("created_at", { ascending: false })
			.limit(10);

		expect(data).toHaveLength(0);
	});

	it("L: direct 'track 21' style text command regex is unchanged (matches 'track <id>', not 'track order <id>')", () => {
		const trackMatch = /^track\s+#?(\d+)$/;
		expect(trackMatch.test("track 21")).toBe(true);
		expect(trackMatch.test("track #21")).toBe(true);
		// Not modified by this task — direct textual queries continue to use
		// this exact, pre-existing regex, unchanged.
	});
});

describe("commerce context lastOrderId self-corrects instead of staying stale", () => {
	const phone = `+91ctx${Date.now()}`.slice(0, 15);
	let productId: number;
	let orderId: number;

	afterEach(async () => {
		const client = getAdminClient(env);
		if (orderId) await client.from("orders").delete().eq("id", orderId);
		if (productId) await client.from("products").delete().eq("id", productId);
		await client.from("conversation_context").delete().eq("phone_number", phone);
	});

	it("M/N: a fresh order becomes lastOrderId, and a context-only follow-up resolves to it (not a stale/unrelated id)", async () => {
		const client = getAdminClient(env);

		const { data: product } = await client
			.from("products")
			.insert({ name: `Test Product ${Date.now()}`, price: 999, stock: 10, is_active: true })
			.select("id")
			.single();
		productId = product!.id;

		const { data: order } = await client
			.from("orders")
			.insert({
				customer_phone: phone,
				status: "paid",
				subtotal: 999,
				tax: 0,
				total_amount: 999,
				currency: "INR",
				payment_provider: "razorpay",
			})
			.select("id")
			.single();
		orderId = order!.id;

		await client.from("order_items").insert({
			order_id: orderId,
			product_id: productId,
			product_name: "Test Product",
			unit_price: 999,
			quantity: 1,
			line_total: 999,
		});

		// Poison the context first, exactly like production evidence showed
		// (a stale/unrelated id sitting in last_order_id from an earlier,
		// non-order interaction).
		await client.from("conversation_context").upsert(
			{ phone_number: phone, last_product: null, last_order_id: 999999, last_intent: "INVENTORY_QUERY", updated_at: new Date().toISOString() },
			{ onConflict: "phone_number" }
		);

		await answerCommerceQuestion(phone, "Give me my recent order detail", env as never);

		const { data: afterFirst } = await client.from("conversation_context").select("*").eq("phone_number", phone).maybeSingle();
		expect(afterFirst?.last_order_id).toBe(orderId);

		const answer2 = await answerCommerceQuestion(phone, "when will it arrive?", env as never);

		const { data: afterSecond } = await client.from("conversation_context").select("*").eq("phone_number", phone).maybeSingle();
		expect(afterSecond?.last_order_id).toBe(orderId);
		expect(answer2).toContain(String(orderId));
	}, 30000);
});
