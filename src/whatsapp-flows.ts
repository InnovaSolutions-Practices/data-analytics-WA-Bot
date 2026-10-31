import { validateDeliveryAddress, type DeliveryAddressInput } from "./commerce";

export function buildDeliveryAddressFlowMessage(
	to: string,
	flowId: string,
	flowToken: string
): Record<string, unknown> {
	return {
		messaging_product: "whatsapp",
		recipient_type: "individual",
		to,
		type: "interactive",
		interactive: {
			type: "flow",
			header: { type: "text", text: "Delivery Address" },
			body: {
				text: "Complete the delivery address form to continue checkout.",
			},
			action: {
				name: "flow",
				parameters: {
					flow_message_version: "3",
					flow_token: flowToken,
					flow_id: flowId,
					flow_cta: "Add address",
					flow_action: "navigate",
					flow_action_payload: { screen: "DELIVERY_ADDRESS" },
				},
			},
		},
	};
}

export function parseDeliveryAddressFlowSubmission(
	responseJson: string
): DeliveryAddressInput {
	let submission: unknown;
	try {
		submission = JSON.parse(responseJson);
	} catch {
		throw new Error("WhatsApp Flow returned invalid JSON");
	}

	if (!submission || typeof submission !== "object" || Array.isArray(submission)) {
		throw new Error("WhatsApp Flow submission must be a JSON object");
	}

	const fields = submission as Record<string, unknown>;
	const stringField = (key: string): string => {
		const value = fields[key];
		if (typeof value !== "string" || !value.trim()) {
			throw new Error(`WhatsApp Flow is missing the ${key} field`);
		}
		return value;
	};

	return validateDeliveryAddress({
		recipient_name: stringField("recipient_name"),
		recipient_phone: stringField("recipient_phone"),
		email: stringField("email"),
		address_line_1: stringField("address_line_1"),
		address_line_2: stringField("address_line_2"),
		city: stringField("city"),
		state: stringField("state"),
		pincode: stringField("pincode"),
		landmark: stringField("landmark"),
	});
}
