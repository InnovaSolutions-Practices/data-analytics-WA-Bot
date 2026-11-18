import { describe, expect, it } from "vitest";
import deliveryAddressFlow from "../whatsapp-flows/delivery-address-flow.json";
import type { DeliveryAddressInput } from "../src/commerce";

import {
	collectDeliveryAddressTextAnswer,
	buildDeliveryAddressFlowMessage,
	extractDeliveryAddressFlowData,
	getDeliveryAddressTextPrompt,
	parseDeliveryAddressFlowSubmission,
	validateCollectedDeliveryAddress,
} from "../src/whatsapp-flows";

describe("WhatsApp delivery address Flow", () => {
	it("defines required and optional fields plus a confirmation screen", () => {
		const screens = deliveryAddressFlow.screens;
		const addressScreen = screens.find((screen) => screen.id === "DETAILS");
		expect(screens[0]?.id).toBe("DETAILS");
		const confirmationScreen = screens.find((screen) => screen.id === "ADDRESS_CONFIRMATION");
		const form = addressScreen?.layout.children.find((child) => child.type === "Form");
		const fieldDefinitions = form?.children
			.filter((child) => child.type === "TextInput")
			.map((child) => ({ name: child.name, required: child.required }));

		expect(deliveryAddressFlow.version).toBe("6.3");
		expect(fieldDefinitions).toEqual([
			{ name: "recipient_name", required: true },
			{ name: "recipient_phone", required: true },
			{ name: "email", required: false },
			{ name: "address_line_1", required: true },
			{ name: "address_line_2", required: false },
			{ name: "city", required: true },
			{ name: "state", required: true },
			{ name: "pincode", required: true },
			{ name: "landmark", required: false },
		]);
		expect(confirmationScreen?.terminal).toBe(true);
		expect(confirmationScreen?.layout.children.some((child) => child.type === "TextBody")).toBe(true);
	});

	it("builds a Flow launch message with a Flow ID and per-request token", () => {
		expect(buildDeliveryAddressFlowMessage("919876543210", "flow-123", "token-456")).toMatchObject({
			type: "interactive",
			to: "919876543210",
			interactive: {
				type: "flow",
				body: {
					text: expect.not.stringContaining("Send your delivery details in one message"),
				},
				action: {
					name: "flow",
					parameters: {
						flow_message_version: "3",
						flow_id: "flow-123",
						flow_token: "token-456",
						flow_action: "navigate",
						flow_action_payload: { screen: "DETAILS" },
					},
				},
			},
		});
	});

	it("validates and normalizes structured Flow submission data", () => {
		expect(parseDeliveryAddressFlowSubmission(JSON.stringify({
			recipient_name: "Robin",
			recipient_phone: "+91 88787 87878",
			email: "robin@example.com",
			address_line_1: "12 Example Road",
			address_line_2: "Apartment 2",
			city: "Pune",
			state: "Maharashtra",
			pincode: "411001",
			landmark: "Near station",
		}))).toMatchObject({
			profile_name: "Robin",
			recipient_name: "Robin",
			recipient_phone: "918878787878",
			email: "robin@example.com",
			address_line_1: "12 Example Road",
			address_line_2: "Apartment 2",
			city: "Pune",
			state: "Maharashtra",
			pincode: "411001",
			landmark: "Near station",
		});
	});

	it("accepts omitted optional fields but rejects missing required fields", () => {
		expect(parseDeliveryAddressFlowSubmission(JSON.stringify({
			recipient_name: "Robin",
			recipient_phone: "918878787878",
			address_line_1: "12 Example Road",
			city: "Pune",
			state: "Maharashtra",
			pincode: "411001",
		}))).toMatchObject({
			email: null,
			address_line_2: null,
			landmark: null,
		});
		expect(() => parseDeliveryAddressFlowSubmission(JSON.stringify({
			recipient_name: "Robin",
			recipient_phone: "918878787878",
			city: "Pune",
			state: "Maharashtra",
			pincode: "411001",
		}))).toThrow("Missing required field: address_line_1");
	});

	it("maps alternate Flow field names to the delivery address schema", () => {
		expect(parseDeliveryAddressFlowSubmission(JSON.stringify({
			full_name: "Robin",
			phone_number: "+91 88787 87878",
			street_address: "12 Example Road",
			city: "Pune",
			state: "Maharashtra",
			postal_code: "411001",
		}))).toMatchObject({
			recipient_name: "Robin",
			recipient_phone: "918878787878",
			address_line_1: "12 Example Road",
			city: "Pune",
			state: "Maharashtra",
			pincode: "411001",
		});
	});

	it("maps screen-generated Flow field IDs to the canonical address schema", () => {
		expect(parseDeliveryAddressFlowSubmission({
			screen_0_Name_0: "Robin",
			screen_0_Mobile_3: "+91 88787 87878",
			screen_0_Address_line1_3: "12 Example Road",
			screen_0_Address_line2_4: "Apartment 2",
			screen_0_city_5: "Pune",
			screen_0_state_6: "Maharashtra",
			screen_0_pincode_7: "411001",
			screen_0_Email_2: "robin@example.com",
		})).toMatchObject({
			recipient_name: "Robin",
			recipient_phone: "918878787878",
			address_line_1: "12 Example Road",
			address_line_2: "Apartment 2",
			city: "Pune",
			state: "Maharashtra",
			pincode: "411001",
			email: "robin@example.com",
			landmark: null,
		});
	});

	it("maps customer_name and uses flow_action_data when response_json is absent", () => {
		const flowData = extractDeliveryAddressFlowData(undefined, {
			customer_name: "Robin",
			phone: "+91 88787 87878",
			address: "12 Example Road",
			city: "Pune",
			state: "Maharashtra",
			pincode: "411001",
		});
		expect(parseDeliveryAddressFlowSubmission(flowData)).toMatchObject({
			recipient_name: "Robin",
			recipient_phone: "918878787878",
			address_line_1: "12 Example Road",
			city: "Pune",
			state: "Maharashtra",
			pincode: "411001",
			email: null,
			address_line_2: null,
			landmark: null,
		});
	});

	it("merges flow_action_data with response_json, preferring response_json values", () => {
		const flowData = extractDeliveryAddressFlowData(
			JSON.stringify({ recipient_name: "Robin" }),
			{ recipient_name: "Earlier Name", phone: "918878787878" }
		);
		expect(flowData).toMatchObject({
			recipient_name: "Robin",
			phone: "918878787878",
		});
	});

	it("reports every missing required field by its canonical name", () => {
		expect(() => parseDeliveryAddressFlowSubmission(JSON.stringify({}))).toThrow(
			"Missing required field: recipient_name; Missing required field: recipient_phone; Missing required field: address_line_1; Missing required field: city; Missing required field: state; Missing required field: pincode"
		);
	});

	it("rejects malformed, incomplete, and invalid Flow submission data", () => {
		expect(() => parseDeliveryAddressFlowSubmission("{")).toThrow("invalid JSON");
		expect(() => parseDeliveryAddressFlowSubmission(JSON.stringify({
			recipient_name: "Robin",
		}))).toThrow("recipient_phone");
		expect(() => parseDeliveryAddressFlowSubmission(JSON.stringify({
			recipient_name: "Robin",
			recipient_phone: "918878787878",
			email: 42,
			address_line_1: "12 Example Road",
			address_line_2: "Apartment 2",
			city: "Pune",
			state: "Maharashtra",
			pincode: "411001",
			landmark: "Near station",
		}))).toThrow("email field must be text");
		expect(() => parseDeliveryAddressFlowSubmission(JSON.stringify({
			recipient_name: "Robin",
			recipient_phone: "123",
			email: "robin@example.com",
			address_line_1: "12 Example Road",
			address_line_2: "Apartment 2",
			city: "Pune",
			state: "Maharashtra",
			pincode: "411001",
			landmark: "Near station",
		}))).toThrow("Recipient phone number");
	});

	it("collects and validates a complete address through chat messages", () => {
		let address: Partial<DeliveryAddressInput> = {};
		const answers = [
			["RECIPIENT_NAME", "Robin Sharma"],
			["RECIPIENT_PHONE", "+91 88787 87878"],
			["EMAIL", "robin@example.com"],
			["ADDRESS_LINE_1", "12 Example Road"],
			["ADDRESS_LINE_2", "Apartment 2"],
			["CITY", "Pune"],
			["STATE", "Maharashtra"],
			["PINCODE", "411001"],
			["LANDMARK", "Near station"],
		] as const;
		let nextStep: string | null = null;

		for (const [step, answer] of answers) {
			const progress = collectDeliveryAddressTextAnswer(step, address, answer);
			address = progress.address;
			nextStep = progress.nextStep;
		}

		expect(nextStep).toBeNull();
		expect(validateCollectedDeliveryAddress(address)).toMatchObject({
			recipient_name: "Robin Sharma",
			recipient_phone: "918878787878",
			email: "robin@example.com",
			address_line_1: "12 Example Road",
			address_line_2: "Apartment 2",
			city: "Pune",
			state: "Maharashtra",
			pincode: "411001",
			landmark: "Near station",
		});
	});

	it("allows optional address details to be skipped and rejects invalid required values", () => {
		const name = collectDeliveryAddressTextAnswer("RECIPIENT_NAME", {}, "Robin");
		const phone = collectDeliveryAddressTextAnswer("RECIPIENT_PHONE", name.address, "8878787878");
		const email = collectDeliveryAddressTextAnswer("EMAIL", phone.address, "SKIP");
		expect(email.address.email).toBeNull();
		expect(getDeliveryAddressTextPrompt("ADDRESS_LINE_2")).toContain("Reply SKIP");
		expect(() => collectDeliveryAddressTextAnswer("PINCODE", {}, "41100")).toThrow("six-digit");
	});
});
