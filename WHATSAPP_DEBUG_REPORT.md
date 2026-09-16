# WhatsApp Menu Debug Report

## Send path

- File: `src/index.ts`
- Function: `sendMainMenuButtons`
- Entry point: the `/webhook` handler calls `sendMainMenuButtons(sender, env)` when the incoming text is `hi`, `hello`, or `start`.
- Success log: `console.log("Interactive main menu sent")` after `sendWhatsAppPayload` resolves.
- Shared sender: `sendWhatsAppPayload`.
- Endpoint: `https://graph.facebook.com/v21.0/${env.PHONE_NUMBER_ID}/messages`.

## Current main-menu payload

The current main-menu payload is:

```json
{
  "messaging_product": "whatsapp",
  "recipient_type": "individual",
  "to": "<sender phone number>",
  "type": "interactive",
  "interactive": {
    "type": "button",
    "header": {
      "type": "text",
      "text": "Innova Solutions"
    },
    "body": {
      "text": "Welcome to Innova Solutions!\n\nHow can we help you today?"
    },
    "footer": {
      "text": "Select one option below"
    },
    "action": {
      "buttons": [
        {
          "type": "reply",
          "reply": {
            "id": "VIEW_PRODUCTS",
            "title": "View Products"
          }
        },
        {
          "type": "reply",
          "reply": {
            "id": "TRACK_ORDER",
            "title": "Track Order"
          }
        },
        {
          "type": "reply",
          "reply": {
            "id": "CUSTOMER_CARE",
            "title": "Customer Care"
          }
        }
      ]
    }
  }
}
```

## Product-list payload

`sendProductList` sends the following structure when products exist:

```json
{
  "messaging_product": "whatsapp",
  "recipient_type": "individual",
  "to": "<sender phone number>",
  "type": "interactive",
  "interactive": {
    "type": "list",
    "header": {
      "type": "text",
      "text": "Innova Solutions"
    },
    "body": {
      "text": "Select a product to add it to your cart."
    },
    "footer": {
      "text": "You can add multiple products one by one."
    },
    "action": {
      "button": "View Products",
      "sections": [
        {
          "title": "Available Products",
          "rows": [
            {
              "id": "ADD_PRODUCT_<numeric id>",
              "title": "<product name, max 24 characters>",
              "description": "INR<price> | Stock: <stock>, max 72 characters"
            }
          ]
        }
      ]
    }
  }
}
```

## Findings

- `type: "interactive"` is used for the main menu and product list. The plain-text helper intentionally uses `type: "text"` for ordinary replies.
- Both interactive payloads include `interactive.type`.
- Both interactive payloads include a non-empty `interactive.body.text`.
- Main-menu button count is 3, and each button is a `reply` button.
- Main-menu titles are under 20 characters: `View Products`, `Track Order`, and `Customer Care`.
- Main-menu IDs are non-empty, simple ASCII IDs, and are handled by the webhook routing code.
- List action button is `View Products`, under 20 characters.
- List section has a title and dynamic rows. Row titles are truncated to 24 characters and descriptions to 72 characters.
- No unsupported fields or malformed JSON were found in these two payloads.
- The endpoint uses `PHONE_NUMBER_ID` in the path. The previous code did not log the resolved ID or the exact serialized payload.
- The previous success log only showed the response body and did not expose the status/body using the requested diagnostic label.

## Exact code change made

In `sendWhatsAppPayload`, before `fetch`:

```typescript
console.log("PHONE_NUMBER_ID:", env.PHONE_NUMBER_ID);
console.log("WhatsApp API URL:", apiUrl);
console.log(
  "Outgoing WhatsApp Payload:",
  JSON.stringify(payload, null, 2)
);
```

Immediately after reading the Meta response:

```typescript
const result = await response.text();
console.log("Meta Response:", response.status, result);
```

This shared function covers the main menu, product list, cart buttons, and all text messages.

## Validation

- `src/index.ts` has no editor-reported TypeScript errors after the change.
- Package compile completed without errors introduced by this change.
- The existing Vitest suite currently has 4 unrelated failures because `test/index.spec.ts` still expects the removed demo `/message` and `/random` routes. It does not exercise the WhatsApp webhook or Graph payload path.

## Operational interpretation

The old `Interactive main menu sent` message was emitted only after Meta returned an HTTP 2xx response. Therefore, the source payload is already in the interactive format and the missing visibility is not explained by an accidental `type: "text"` in `sendMainMenuButtons`. Deploy this diagnostic build, send `hi`, and inspect `Outgoing WhatsApp Payload`, `PHONE_NUMBER_ID`, `WhatsApp API URL`, and `Meta Response` together. The Meta response body is now retained in the logs for the exact message acceptance result.

## Webhook Routing Report

### A. Current route table

| Method | Path | Behavior |
|---|---|---|
| GET | `/ai-test` | Runs the RAG response test and returns JSON. |
| GET | `/webhook` | Verifies Meta's `hub.mode`, `hub.verify_token`, and `hub.challenge`. |
| POST | `/razorpay-webhook` | Processes Razorpay events. |
| POST | `/webhook` | Parses the WhatsApp event, logs it, schedules message processing, and returns `EVENT_RECEIVED`. |
| Any other method/path | Any | Returns `WhatsApp commerce bot is running.` |

### B. Execution flow

1. `fetch()` constructs `new URL(request.url)` and logs `[REQUEST]`, method, and pathname.
2. `GET /webhook` enters verification. A matching token and challenge return the challenge with 200; otherwise it returns `Forbidden` with 403.
3. `POST /webhook` enters after the Razorpay branch because the path is different.
4. The body is parsed with `await request.json()` inside a diagnostic `try/catch`.
5. A valid body logs `Incoming WhatsApp Event` before message extraction.
6. Status-only events without `messages[0]` are acknowledged with `EVENT_RECEIVED`.
7. Message events log `Parsed WhatsApp input`, schedule the async handler with `ctx.waitUntil()`, and immediately return `EVENT_RECEIVED`.

### C. Where POST `/webhook` can stop

- No route conflict exists. `POST /webhook` remains reachable.
- The only operation between entering that branch and `Incoming WhatsApp Event` is `request.json()`. Invalid or empty JSON now logs `[WEBHOOK POST] JSON parse failed` and returns 400.
- If neither `[REQUEST] POST /webhook` nor `[WEBHOOK POST] Handler entered` appears, Meta is not reaching this Worker route. That indicates webhook subscription, callback URL, deployment/environment, or upstream delivery trouble, not RAG, Supabase, carts, payments, or conversation state.
- If `[WEBHOOK POST] Handler entered` appears but JSON parsing fails, the delivered body is not valid JSON.
- If `Incoming WhatsApp Event` appears but no reply is sent, the failure is after parsing and is captured by `WhatsApp processing failed`.

### D. Files involved

- `src/index.ts`: Worker routing, verification, WhatsApp POST handling, RAG integration, database/cart/payment dispatch.
- `src/rag.ts`: RAG lookup and generation used only by the unknown-text fallback after webhook parsing.
- `wrangler.jsonc`: Worker entrypoint is `src/index.ts`; no route override is configured here.
- `WHATSAPP_DEBUG_REPORT.md`: This diagnostic report.

### E. History result

The repository contains only one commit, `9251e5c Initial commit`, so there is no committed “recent change” history to compare. The current source does show RAG integration in `generateAIResponse`, but that function is called only after the webhook has already logged `Incoming WhatsApp Event`; it cannot explain the absence of the POST route log.

### F. Exact code fix

Added at the start of `fetch()`:

```typescript
console.log("[REQUEST]", request.method, url.pathname);
```

Added to `POST /webhook`:

```typescript
console.log("[WEBHOOK POST] Handler entered");

let body: any;
try {
  body = await request.json();
} catch (error) {
  console.error("[WEBHOOK POST] JSON parse failed:", error);
  console.log("[RETURN] POST /webhook 400");
  return new Response("Invalid JSON", { status: 400 });
}
```

Added branch and return markers for verification success/failure, status-only events, all WhatsApp message branches, route delegation, and unmatched routes.

## Routing Validation

- `src/index.ts` reports no editor diagnostics.
- `npx tsc --noEmit` completed successfully.
- Existing Vitest tests remain stale: they assert removed `/message` and `/random` demo routes and are unrelated to this routing fix.
