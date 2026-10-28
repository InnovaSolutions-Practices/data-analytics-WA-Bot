import { describe, expect, it } from "vitest";

import { validateDeliveryAddress } from "../src/commerce";

const validAddress = {
	recipient_name: "Rahul Sharma",
	recipient_phone: "+91 98765-43210",
	email: "rahul@example.com",
	address_line_1: "42 MG Road",
	address_line_2: "Apartment 5B",
	city: "Bengaluru",
	state: "Karnataka",
	pincode: "560001",
	landmark: "Near Trinity Metro",
};

describe("validateDeliveryAddress", () => {
	it("normalizes recipient phone digits and preserves recipient/address casing", () => {
		expect(validateDeliveryAddress(validAddress)).toEqual({
			...validAddress,
			recipient_phone: "919876543210",
		});
	});

	it("accepts omitted optional fields", () => {
		expect(validateDeliveryAddress({
			...validAddress,
			email: null,
			address_line_2: null,
			landmark: null,
		})).toMatchObject({
			email: null,
			address_line_2: null,
			landmark: null,
		});
	});

	it("rejects invalid recipient phone numbers", () => {
		expect(() => validateDeliveryAddress({
			...validAddress,
			recipient_phone: "123",
		})).toThrow("Recipient phone number must contain 8 to 15 digits");
	});

	it("rejects invalid email addresses", () => {
		expect(() => validateDeliveryAddress({
			...validAddress,
			email: "not-an-email",
		})).toThrow("Enter a valid email address or reply SKIP");
	});

	it("rejects non-six-digit Indian pincodes", () => {
		expect(() => validateDeliveryAddress({
			...validAddress,
			pincode: "56001",
		})).toThrow("Pincode must contain exactly 6 digits");
	});

	it("rejects missing required address fields", () => {
		expect(() => validateDeliveryAddress({
			...validAddress,
			city: " ",
		})).toThrow("City is required");
	});
});
