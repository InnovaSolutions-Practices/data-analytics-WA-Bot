# WhatsApp Delivery Address Flow

## Flow definition

The source definition to import/create in Meta is [delivery-address-flow.json](../whatsapp-flows/delivery-address-flow.json). It is a client-side WhatsApp Flow with:

| Field | Key | Required |
|---|---|---|
| Full Name | `recipient_name` | Yes |
| Phone Number | `recipient_phone` | Yes |
| Street Address | `address_line_1` | Yes |
| City | `city` | Yes |
| State | `state` | Yes |
| PIN Code | `pincode` | Yes |
| Email | `email` | No |
| Address Line 2 | `address_line_2` | No |
| Landmark | `landmark` | No |

The first screen collects the fields and navigates to a confirmation screen. The final confirmation button uses the Flow `complete` action, sending the values in `interactive.nfm_reply.response_json`. The Worker maps supported alternate field names to the canonical keys before validating required fields, phone number, email if supplied, and the six-digit PIN code; client-side `required` flags are not treated as a security boundary.

The canonical-to-alternate mapping is `recipient_name` (`full_name`, `name`), `recipient_phone` (`phone_number`, `mobile`, `phone`), `address_line_1` (`street_address`, `address`), `address_line_2` (`apartment`, `suite`), and `pincode` (`postal_code`, `zip`, `postal`). `email`, `city`, `state`, and `landmark` use their canonical names. Validation errors name every missing canonical required field. The Worker logs the received payload's field names and shape under `[FLOW SUBMISSION RECEIVED]`, but redacts values to avoid putting phone numbers, emails, and addresses in logs.

## Create and publish in Meta Business Manager

1. Open Meta Business Suite/Business Manager and select the business that owns the WhatsApp Business Account (WABA) connected to this Worker.
2. Open **WhatsApp Manager → Account tools → Flows** (Meta may label the menu **Flows** or **WhatsApp Flows**).
3. Create a Flow named **Delivery Address**. Select the category accepted for this use by the WABA (the current project handover uses `OTHER`).
4. Import/paste the contents of `whatsapp-flows/delivery-address-flow.json` in the Flow builder or create the same screens and fields in the builder. Use the form field keys shown in the table above where possible; the Worker also supports the documented alternate names.
5. Validate the Flow in Meta's builder, fix any validation errors, then **Publish** it. A draft Flow ID is not sufficient for sending the Flow to customers.
6. Copy the published Flow's ID. This is the value for the Worker binding below.
7. Ensure the WABA's API access token can send messages for the configured phone number, and use the matching `PHONE_NUMBER_ID`.

The exact UI labels can differ by Meta Business Suite version. Alternatively, create and publish the same definition with the Meta WhatsApp Flows API using a WABA-authorized access token, then retain the returned Flow `id`.

## Configure Worker values

`WHATSAPP_DELIVERY_FLOW_ID` is the only Flow-specific Worker secret/configuration. Its value must be the published Meta Flow ID, copied verbatim—do not use the Flow name, WABA ID, phone-number ID, or a token.

```sh
npx wrangler secret put WHATSAPP_DELIVERY_FLOW_ID
```

Paste the published Flow ID at the prompt. Run this command against the correct Cloudflare account and Worker environment (use the corresponding Wrangler environment flags/configuration if the project deploys named environments). For local development, set `WHATSAPP_DELIVERY_FLOW_ID=<published Flow ID>` in the ignored `.dev.vars` file and restart `wrangler dev`.

The Flow does not require `WHATSAPP_FLOW_TOKEN` or a Flow data-endpoint encryption secret. The message's `flow_token` is generated per launch with `crypto.randomUUID()`.

Other existing checkout integrations must also be configured; they are not Flow-specific:

| Variable | Expected value |
|---|---|
| `WHATSAPP_TOKEN` | WhatsApp Cloud API access token authorized to send messages for this WABA/phone number. |
| `PHONE_NUMBER_ID` | Meta Cloud API phone-number ID used in the messages endpoint. |
| `SUPABASE_URL` | Supabase project URL containing the commerce schema. |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-only Supabase service-role key for saving addresses and orders. |
| `RAZORPAY_KEY_ID` | Razorpay API key ID used to create payment links. |
| `RAZORPAY_KEY_SECRET` | Matching Razorpay API key secret. |

Never put access tokens, service-role keys, or Razorpay credentials in the Flow JSON or frontend assets. Only `WHATSAPP_DELIVERY_FLOW_ID` identifies the Flow.

## Runtime sequence

1. `DELIVERY_ADD_NEW` is handled by `handleDeliveryConversation()` in `src/index.ts`.
2. `startDeliveryAddressFlow()` persists `DELIVERY_DETAILS` with `step: "FLOW_WAIT"`, then `sendDeliveryFlowPrompt()` builds and sends the Flow message using `WHATSAPP_DELIVERY_FLOW_ID`.
3. If the Flow ID is absent, the Worker warns and uses the existing chat-based address fallback. A configured Flow launch failure is logged and surfaced; it does not switch to text collection.
4. Meta posts the completed `response_json` to `POST /webhook`.
5. `handleDeliveryFlowSubmission()` parses and validates it, then calls `saveAndContinueWithDeliveryAddress()`.
6. `saveAndContinueWithDeliveryAddress()` calls `saveDeliveryAddressForCustomer()` in `src/commerce.ts`, which inserts the address for the trusted customer ID or updates only an explicitly selected `update_address_id`.
7. For checkout (`source: "CHECKOUT_DELIVERY"`), `finishCheckoutWithDeliveryAddress()` creates the order from the active cart, initializes delivery details, links the saved address to the order, creates the Razorpay payment link, records its ID/URL, and sends the payment URL to the customer in WhatsApp.

## Example outgoing Flow message

The Worker sends a WhatsApp Cloud API message with this relevant shape (the actual `to`, `flow_id`, and generated token are runtime values):

```json
{
  "messaging_product": "whatsapp",
  "recipient_type": "individual",
  "to": "919876543210",
  "type": "interactive",
  "interactive": {
    "type": "flow",
    "header": { "type": "text", "text": "Delivery Address" },
    "body": { "text": "Complete the delivery address form to continue checkout." },
    "action": {
      "name": "flow",
      "parameters": {
        "flow_message_version": "3",
        "flow_token": "<generated-per-launch>",
        "flow_id": "<published-meta-flow-id>",
        "flow_cta": "Add address",
        "flow_action": "navigate",
        "flow_action_payload": { "screen": "DETAILS" }
      }
    }
  }
}
```

## Example inbound completion webhook

Meta includes the submitted fields as a JSON-encoded `response_json` string in the `interactive.nfm_reply` message. The webhook envelope is simplified here:

```json
{
  "object": "whatsapp_business_account",
  "entry": [{
    "changes": [{
      "value": {
        "messages": [{
          "from": "919876543210",
          "id": "wamid.example",
          "type": "interactive",
          "interactive": {
            "type": "nfm_reply",
            "nfm_reply": {
              "name": "flow",
              "response_json": "{\"recipient_name\":\"Robin Sharma\",\"recipient_phone\":\"918878787878\",\"address_line_1\":\"12 Example Road\",\"city\":\"Pune\",\"state\":\"Maharashtra\",\"pincode\":\"411001\",\"email\":\"robin@example.com\",\"address_line_2\":\"Apartment 2\",\"landmark\":\"Near station\"}"
            }
          }
        }]
      }
    }]
  }]
}
```

Optional fields may be absent or empty. The Worker normalizes those values to `null`; it independently validates required values before writing to Supabase.
