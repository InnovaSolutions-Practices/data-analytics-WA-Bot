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
					flow_action_payload: { screen: "DETAILS" },
				},
			},
		},
	};
}

function parseFlowDataObject(value: unknown): Record<string, unknown> {
	if (typeof value === "string") {
		let parsed: unknown;
		try {
			parsed = JSON.parse(value);
		} catch {
			throw new Error("WhatsApp Flow returned invalid JSON");
		}
		return parseFlowDataObject(parsed);
	}
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new Error("WhatsApp Flow submission must be a JSON object");
	}
	return value as Record<string, unknown>;
}

export function extractDeliveryAddressFlowData(
	responseJson: unknown,
	flowActionData?: unknown
): Record<string, unknown> {
	const actionData = flowActionData === undefined || flowActionData === null
		? {}
		: parseFlowDataObject(flowActionData);
	const responseData = responseJson === undefined || responseJson === null
		? {}
		: parseFlowDataObject(responseJson);
	return { ...actionData, ...responseData };
}

export function parseDeliveryAddressFlowSubmission(
	submission: unknown
): DeliveryAddressInput {
	const fields = parseFlowDataObject(submission);

	type FlowField = Exclude<keyof DeliveryAddressInput, "profile_name">;
	const fieldAliases: Record<FlowField, readonly string[]> = {
		recipient_name: ["recipient_name", "screen_0_Name_0", "full_name", "name", "customer_name"],
		recipient_phone: ["recipient_phone", "screen_0_Mobile_3", "phone_number", "mobile", "phone"],
		email: ["email", "screen_0_Email_2"],
		address_line_1: ["address_line_1", "screen_0_Address_line1_3", "street_address", "address"],
		address_line_2: ["address_line_2", "screen_0_Address_line2_4", "apartment", "suite"],
		city: ["city", "screen_0_city_5"],
		state: ["state", "screen_0_state_6"],
		pincode: ["pincode", "screen_0_pincode_7", "postal_code", "zip", "postal"],
		landmark: ["landmark"],
	};

	const normalizedFields: Partial<Record<FlowField, string | null>> = {};
	for (const [field, aliases] of Object.entries(fieldAliases) as [
		FlowField,
		readonly string[],
	][]) {
		const suppliedValues = aliases
			.filter((alias) => fields[alias] !== undefined && fields[alias] !== null)
			.map((alias) => fields[alias]);
		const textValue = suppliedValues.find(
			(value): value is string => typeof value === "string" && Boolean(value.trim())
		);
		if (textValue !== undefined) {
			normalizedFields[field] = textValue.trim();
			continue;
		}
		if (suppliedValues.some((value) => typeof value !== "string")) {
			throw new Error(`WhatsApp Flow ${field} field must be text`);
		}
		normalizedFields[field] = null;
	}

	const normalizedAddress = {
		recipient_name: normalizedFields.recipient_name,
		recipient_phone: normalizedFields.recipient_phone,
		address_line_1: normalizedFields.address_line_1,
		address_line_2: normalizedFields.address_line_2 ?? null,
		city: normalizedFields.city,
		state: normalizedFields.state,
		pincode: normalizedFields.pincode,
		email: normalizedFields.email ?? null,
		landmark: normalizedFields.landmark ?? null,
	};
	console.log("[FLOW NORMALIZED ADDRESS]", JSON.stringify(normalizedAddress, null, 2));

	const requiredFields: FlowField[] = [
		"recipient_name",
		"recipient_phone",
		"address_line_1",
		"city",
		"state",
		"pincode",
	];
	const missingFields = requiredFields.filter((field) => !normalizedFields[field]);
	if (missingFields.length) {
		throw new Error(
			missingFields
				.map((field) => `Missing required field: ${field}`)
				.join("; ")
		);
	}

	const requiredStringField = (field: FlowField): string => {
		const value = normalizedFields[field];
		if (!value) {
			throw new Error(`Missing required field: ${field}`);
		}
		return value;
	};
	const optionalStringField = (key: FlowField): string | null => {
		const value = normalizedFields[key];
		if (value === undefined || value === null) {
			return null;
		}
		return value;
	};

	return validateDeliveryAddress({
		recipient_name: requiredStringField("recipient_name"),
		recipient_phone: requiredStringField("recipient_phone"),
		email: optionalStringField("email"),
		address_line_1: requiredStringField("address_line_1"),
		address_line_2: optionalStringField("address_line_2"),
		city: requiredStringField("city"),
		state: requiredStringField("state"),
		pincode: requiredStringField("pincode"),
		landmark: optionalStringField("landmark"),
	});
}

export type DeliveryAddressTextStep =
	| "RECIPIENT_NAME"
	| "RECIPIENT_PHONE"
	| "EMAIL"
	| "ADDRESS_LINE_1"
	| "ADDRESS_LINE_2"
	| "CITY"
	| "STATE"
	| "PINCODE"
	| "LANDMARK";

const DELIVERY_ADDRESS_TEXT_FIELDS: ReadonlyArray<{
	step: DeliveryAddressTextStep;
	field: keyof DeliveryAddressInput;
	label: string;
	optional: boolean;
	maxLength: number;
}> = [
	{ step: "RECIPIENT_NAME", field: "recipient_name", label: "recipient's full name", optional: false, maxLength: 100 },
	{ step: "RECIPIENT_PHONE", field: "recipient_phone", label: "recipient's phone number", optional: false, maxLength: 20 },
	{ step: "EMAIL", field: "email", label: "email address", optional: true, maxLength: 254 },
	{ step: "ADDRESS_LINE_1", field: "address_line_1", label: "street address and house/building number", optional: false, maxLength: 500 },
	{ step: "ADDRESS_LINE_2", field: "address_line_2", label: "apartment, suite, or address line 2", optional: true, maxLength: 500 },
	{ step: "CITY", field: "city", label: "city", optional: false, maxLength: 100 },
	{ step: "STATE", field: "state", label: "state", optional: false, maxLength: 100 },
	{ step: "PINCODE", field: "pincode", label: "six-digit PIN code", optional: false, maxLength: 6 },
	{ step: "LANDMARK", field: "landmark", label: "nearby landmark", optional: true, maxLength: 200 },
];

export function getDeliveryAddressTextPrompt(step: DeliveryAddressTextStep): string {
	const field = DELIVERY_ADDRESS_TEXT_FIELDS.find((item) => item.step === step);
	if (!field) {
		throw new Error(`Unsupported delivery address text step: ${step}`);
	}

	return `Please enter the ${field.label}.${field.optional ? " Reply SKIP if you want to leave this blank." : ""}`;
}

export function collectDeliveryAddressTextAnswer(
	step: DeliveryAddressTextStep,
	currentAddress: Partial<DeliveryAddressInput>,
	answer: string
): { address: Partial<DeliveryAddressInput>; nextStep: DeliveryAddressTextStep | null } {
	const index = DELIVERY_ADDRESS_TEXT_FIELDS.findIndex((item) => item.step === step);
	const field = DELIVERY_ADDRESS_TEXT_FIELDS[index];
	if (!field) {
		throw new Error(`Unsupported delivery address text step: ${step}`);
	}

	const normalizedAnswer = answer.trim();
	const skipped = field.optional && /^skip$/i.test(normalizedAnswer);
	if (!normalizedAnswer && !field.optional) {
		throw new Error("This field is required. Please send a value to continue.");
	}
	if (!normalizedAnswer && field.optional) {
		throw new Error("Reply SKIP to leave this field blank.");
	}

	const value = skipped ? null : normalizedAnswer;
	if (typeof value === "string" && value.length > field.maxLength) {
		throw new Error(`Please keep this answer to ${field.maxLength} characters or fewer.`);
	}
	if (step === "RECIPIENT_PHONE" && typeof value === "string") {
		const digits = value.replace(/\D/g, "");
		if (digits.length < 8 || digits.length > 15) {
			throw new Error("Please send a phone number containing 8 to 15 digits.");
		}
	}
	if (step === "EMAIL" && typeof value === "string" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
		throw new Error("Please send a valid email address or reply SKIP.");
	}
	if (step === "PINCODE" && typeof value === "string" && !/^\d{6}$/.test(value)) {
		throw new Error("Please send a valid six-digit PIN code.");
	}

	const address = { ...currentAddress };
	switch (field.field) {
		case "recipient_name":
			address.recipient_name = String(value ?? "");
			break;
		case "recipient_phone":
			address.recipient_phone = String(value ?? "");
			break;
		case "email":
			address.email = value;
			break;
		case "address_line_1":
			address.address_line_1 = String(value ?? "");
			break;
		case "address_line_2":
			address.address_line_2 = value;
			break;
		case "city":
			address.city = String(value ?? "");
			break;
		case "state":
			address.state = String(value ?? "");
			break;
		case "pincode":
			address.pincode = String(value ?? "");
			break;
		case "landmark":
			address.landmark = value;
			break;
		case "profile_name":
			break;
	}

	return {
		address,
		nextStep: DELIVERY_ADDRESS_TEXT_FIELDS[index + 1]?.step ?? null,
	};
}

export function validateCollectedDeliveryAddress(
	address: Partial<DeliveryAddressInput>
): DeliveryAddressInput {
	return validateDeliveryAddress({
		profile_name: address.profile_name,
		recipient_name: address.recipient_name ?? "",
		recipient_phone: address.recipient_phone ?? "",
		email: address.email,
		address_line_1: address.address_line_1 ?? "",
		address_line_2: address.address_line_2,
		city: address.city ?? "",
		state: address.state ?? "",
		pincode: address.pincode ?? "",
		landmark: address.landmark,
	});
}
