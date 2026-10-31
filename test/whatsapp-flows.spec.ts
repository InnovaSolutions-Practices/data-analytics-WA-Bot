import { describe, expect, it } from "vitest";
import deliveryAddressFlow from "../whatsapp-flows/delivery-address-flow.json";

import {
	buildDeliveryAddressFlowMessage,
	parseDeliveryAddressFlowSubmission,
} from "../src/whatsapp-flows";

describe("WhatsApp delivery address Flow", () => {
	it("defines all requested required fields plus a confirmation screen", () => {
		const screens = deliveryAddressFlow.screens;
		const addressScreen = screens.find((screen) => screen.id === "DELIVERY_ADDRESS");
		const confirmationScreen = screens.find((screen) => screen.id === "ADDRESS_CONFIRMATION");
		const form = addressScreen?.layout.children.find((child) => child.type === "Form");
		const fieldDefinitions = form?.children
			.filter((child) => child.type === "TextInput")
			.map((child) => ({ name: child.name, required: child.required }));

		expect(deliveryAddressFlow.version).toBe("6.3");
		expect(fieldDefinitions).toEqual([
			{ name: "recipient_name", required: true },
			{ name: "recipient_phone", required: true },
			{ name: "email", required: true },
			{ name: "address_line_1", required: true },
			{ name: "address_line_2", required: true },
			{ name: "city", required: true },
			{ name: "state", required: true },
			{ name: "pincode", required: true },
			{ name: "landmark", required: true },
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
						flow_action_payload: { screen: "DELIVERY_ADDRESS" },
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

	it("rejects malformed, incomplete, and invalid Flow submission data", () => {
		expect(() => parseDeliveryAddressFlowSubmission("{")).toThrow("invalid JSON");
		expect(() => parseDeliveryAddressFlowSubmission(JSON.stringify({
			recipient_name: "Robin",
		}))).toThrow("recipient_phone");
		expect(() => parseDeliveryAddressFlowSubmission(JSON.stringify({
			recipient_name: "Robin",
			recipient_phone: "918878787878",
			email: "",
			address_line_1: "12 Example Road",
			address_line_2: "Apartment 2",
			city: "Pune",
			state: "Maharashtra",
			pincode: "411001",
			landmark: "Near station",
		}))).toThrow("email field");
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
});
