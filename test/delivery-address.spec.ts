import { describe, expect, it } from "vitest";

import {
	parseDeliveryAddressMessage,
	validateDeliveryAddress,
} from "../src/commerce";

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
			profile_name: "Rahul Sharma",
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

	it("parses a complete WhatsApp address form", () => {
		const result = parseDeliveryAddressMessage([
			"Name: Yash Gupta",
			"Phone: 916280316170",
			"Email: yash@gmail.com",
			"Address: House 40/1",
			"City: Ferozepur Cantt",
			"State: Punjab",
			"Pincode: 152001",
			"Landmark: Kali Mata Mandir",
		].join("\n"));

		expect(result).toMatchObject({
			isStructured: true,
			missingFields: [],
			validationError: null,
			address: {
				profile_name: "Yash Gupta",
				recipient_name: "Yash Gupta",
				recipient_phone: "916280316170",
				email: "yash@gmail.com",
				address_line_1: "House 40/1",
				city: "Ferozepur Cantt",
				state: "Punjab",
				pincode: "152001",
				landmark: "Kali Mata Mandir",
			},
		});
	});

	it.each([
		["pincode", "Name: Yash\nPhone: 916280316170\nAddress: House 40/1\nCity: Ferozepur\nState: Punjab"],
		["phone", "Name: Yash\nAddress: House 40/1\nCity: Ferozepur\nState: Punjab\nPincode: 152001"],
		["city", "Name: Yash\nPhone: 916280316170\nAddress: House 40/1\nState: Punjab\nPincode: 152001"],
	])("reports a missing %s in the single-message form", (_field, message) => {
		const result = parseDeliveryAddressMessage(message);
		expect(result.isStructured).toBe(true);
		expect(result.address).toBeNull();
		expect(result.missingFields.length).toBeGreaterThan(0);
	});

	it("rejects an invalid email in the single-message form", () => {
		const result = parseDeliveryAddressMessage([
			"Name: Yash Gupta",
			"Phone: 916280316170",
			"Email: invalid-email",
			"Address: House 40/1",
			"City: Ferozepur Cantt",
			"State: Punjab",
			"Pincode: 152001",
		].join("\n"));

		expect(result.isStructured).toBe(true);
		expect(result.address).toBeNull();
		expect(result.validationError).toBe("Enter a valid email address or reply SKIP");
	});

	it("does not mistake a field-by-field response for a form", () => {
		expect(parseDeliveryAddressMessage("Yash Gupta")).toMatchObject({
			isStructured: false,
			address: null,
		});
	});
});
