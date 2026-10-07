# Innova Solutions WhatsApp Bot
# Complete Technical Handover

**Generated:** 2026-09-23  
**Repository:** `data-analytics-WA-Bot`  
**Purpose:** AI-ready handover for a new Copilot account or developer

This document describes the implementation currently present in the repository. It is based on the source files, migrations, configuration, scripts, and tests as they exist now. It does not describe an aspirational architecture unless explicitly marked as recommended.

## 1. Project Overview

### What the project does

This project is a Cloudflare Worker-based WhatsApp commerce and customer-support bot for Innova Solutions. It currently supports:

- WhatsApp Cloud API webhook verification and inbound messages
- Product browsing from Supabase
- Shopping carts and cart items
- Order creation from a cart
- Razorpay payment-link creation and payment webhook confirmation
- Live order-status lookups from Supabase
- PDF-based FAQ retrieval using OpenAI embeddings and Supabase pgvector
- Support-ticket creation from WhatsApp support intents
- Support-ticket status lookup from WhatsApp
- Customer replies and image attachments on active support tickets
- Admin-only order-status and support-ticket APIs
- WhatsApp notifications for order and support-ticket status changes
- Admin replies to customers through WhatsApp
- Ticket message history for agent and customer messages

The Worker entry point is [`src/index.ts`](../src/index.ts), configured by [`wrangler.jsonc`](../wrangler.jsonc). The reusable database, order, ticket, payment, and conversation functions are in [`src/commerce.ts`](../src/commerce.ts). RAG and OpenAI functions are in [`src/rag.ts`](../src/rag.ts).

### Main business flow

```text
Customer sends WhatsApp message
        |
        v
Meta WhatsApp Cloud API POST /webhook
        |
        v
Cloudflare Worker parses message, sender, message id, text, button/list data
        |
        v
Intent and workflow branches
        |
        +--> Menu / product browsing / cart / checkout
        |
        +--> Order tracking -> live Supabase orders query
        |
        +--> Support ticket status -> active support_tickets query
        |
        +--> Active ticket text/image -> ticket_messages history
        |
        +--> Support issue -> create support_tickets row
        |
        +--> Unknown text -> OpenAI embedding -> pgvector -> OpenAI answer
        |
        v
WhatsApp Cloud API outbound message
```

### Architecture

The runtime is a single Worker with a large request handler and two supporting modules:

- **Transport/orchestration:** `src/index.ts`
- **Commerce and persistence services:** `src/commerce.ts`
- **RAG/OpenAI services:** `src/rag.ts`
- **PDF ingestion:** `scripts/ingest-pdf.ts`
- **Database schema:** `supabase/migrations/*.sql`
- **Static asset:** `public/index.html`
- **Tests:** `src/rag.spec.ts` and `test/index.spec.ts`

The current design is synchronous at the service level but acknowledges WhatsApp POST requests quickly. Inbound WhatsApp message processing is scheduled with `ctx.waitUntil(...)`, and the Worker returns `EVENT_RECEIVED` before the downstream database and outbound-message work has necessarily completed.

## 2. Tech Stack

### Languages and build tools

- TypeScript
- SQL/PostgreSQL
- HTML/JavaScript for the starter static asset
- Node.js tooling for PDF ingestion and tests
- Wrangler for Cloudflare Worker development and deployment
- Vitest with `@cloudflare/vitest-pool-workers`

### Runtime services

- Cloudflare Workers
- Cloudflare Workers AI binding is configured as `AI`, although the current application RAG path uses OpenAI directly
- Supabase Postgres
- Supabase pgvector extension
- Meta WhatsApp Cloud API
- OpenAI Embeddings API
- OpenAI Chat Completions API
- Razorpay Payment Links API and webhook API

### Major packages

From [`package.json`](../package.json):

- `@supabase/supabase-js`: Supabase database client
- `@supabase/server`: installed but not the primary client used in the inspected runtime
- `pdf-parse`: PDF text extraction
- `dotenv`: local ingestion environment loading
- `tsx`: TypeScript script execution
- `wrangler`: Cloudflare Worker CLI
- `vitest`: test runner
- `@cloudflare/vitest-pool-workers`: Worker test runtime
- `typescript`: compiler

## 3. Database Documentation

Migrations are ordered from `001` through `009` under [`supabase/migrations`](../supabase/migrations). They use `CREATE TABLE IF NOT EXISTS` and `CREATE INDEX IF NOT EXISTS` heavily. The application uses the Supabase service-role client for most writes and sensitive reads.

### `customers`

**Defined in:** `001_commerce_schema.sql`

**Purpose:** Stores customer identity associated with WhatsApp numbers.

**Key columns:**

- `id BIGSERIAL PRIMARY KEY`
- `whatsapp_number TEXT NOT NULL UNIQUE`
- `name`
- `email`
- `metadata JSONB`
- `created_at`, `updated_at`

**Relationships:**

- Referenced by `carts.customer_id`
- Referenced by `orders.customer_id`
- Referenced by `support_tickets.customer_id`

**Usage:**

- `upsertCustomer()` in `src/commerce.ts`
- Customer identity is generally also carried as `customer_phone` directly on carts, orders, and tickets.

### `products`

**Defined in:** `001_commerce_schema.sql`

**Purpose:** Product catalog and inventory-facing product data.

**Key columns:**

- `id`
- `name`
- `sku UNIQUE`
- `description`
- `category`
- `price NUMERIC(12,2)`
- `stock INTEGER`
- `is_active BOOLEAN`
- `image_url`
- `metadata`
- timestamps

**Relationships:**

- Referenced by `cart_items.product_id`
- Referenced optionally by `order_items.product_id`
- Referenced optionally by `knowledge_base.product_id`

**Usage:**

- Product list reads in `sendProductList()` use the public Supabase client.
- Cart additions and quantity validation use the admin client in `commerce.ts`.
- Stock is checked before cart addition and checkout, but stock is not decremented or reserved after purchase.

**Important current issue:** RLS policies in the migrations provide service-role access but no explicit anonymous/public read policy. `sendProductList()` uses `SUPABASE_ANON_KEY`, so production product listing depends on the actual Supabase policy state.

### `carts`

**Defined in:** `001_commerce_schema.sql`

**Purpose:** Active and historical shopping cart containers.

**Key columns:**

- `id`
- `customer_id` nullable foreign key
- `customer_phone`
- `status`: `active`, `checked_out`, `abandoned`, or `closed`
- timestamps

**Relationships:**

- `customer_id -> customers.id`
- Parent of `cart_items`

**Usage:**

- `getActiveCart()` finds the latest active cart for a phone number.
- `createCart()` creates an active cart when needed.
- `clearCart()` removes items and closes the cart.
- Checkout marks the cart `checked_out`.

### `cart_items`

**Defined in:** `001_commerce_schema.sql`

**Purpose:** Products and quantities currently in a cart.

**Key columns:**

- `id`
- `cart_id`
- `product_id`
- `product_name`
- `unit_price`
- `quantity`
- timestamps
- unique `(cart_id, product_id)`

**Relationships:**

- `cart_id -> carts.id ON DELETE CASCADE`
- `product_id -> products.id ON DELETE RESTRICT`

**Usage:**

- Add, remove, quantity update, display, total calculation, and checkout conversion in `commerce.ts` and `index.ts`.

### `orders`

**Defined initially in:** `001_commerce_schema.sql`  
**Adjusted by:** `002_fix_orders_schema.sql` and `006_status_constraint_updates.sql`

**Purpose:** Current customer order and payment state.

**Columns defined or expected by the current code:**

- `id`
- `customer_id`
- `customer_phone`
- `meta_message_id`
- `status`
- `subtotal`
- `tax`
- `total_amount`
- `currency`
- `payment_provider`
- `razorpay_payment_link_id`
- `razorpay_payment_link_url`
- `razorpay_payment_id`
- `paid_at`
- `created_at`
- `updated_at`

The older/legacy paths in `index.ts` also query or insert these columns:

- `product_id`
- `product_name`
- `quantity`
- `unit_price`
- `amount`

`001` does not define all of those legacy columns. `002` relaxes legacy constraints but does not add missing columns. This is a verified schema/code compatibility risk that must be resolved against the real production database before relying on the legacy path.

**Relationships:**

- `customer_id -> customers.id`
- Parent of `order_items`
- Parent of `order_status_history`
- Referenced optionally by `notification_events.order_id`
- Referenced optionally by `support_tickets.order_id`

**Current status values:**

Legacy values preserved by `006`:

- `pending`
- `payment_pending`
- `paid`
- `failed`
- `cancelled`
- `fulfilled`

New fulfillment values added by `006`:

- `PACKED`
- `SHIPPED`
- `OUT_FOR_DELIVERY`
- `DELIVERED`

`commerce.ts` transition rules currently allow:

```text
pending -> payment_pending | paid | failed | cancelled
payment_pending -> paid | failed | cancelled
paid -> PACKED | fulfilled | cancelled
PACKED -> SHIPPED | cancelled
SHIPPED -> OUT_FOR_DELIVERY | cancelled
OUT_FOR_DELIVERY -> DELIVERED | cancelled
```

`cancelled`, `fulfilled`, and `DELIVERED` are terminal in the service transition map.

### `order_items`

**Defined in:** `001_commerce_schema.sql`

**Purpose:** Line items for multi-product orders.

**Key columns:**

- `id`
- `order_id`
- `product_id nullable`
- `product_name`
- `unit_price`
- `quantity`
- `line_total`
- `created_at`

**Relationships:**

- `order_id -> orders.id ON DELETE CASCADE`
- `product_id -> products.id ON DELETE SET NULL`

**Usage:**

- `createOrderFromCart()` converts cart items into order items.
- Order status responses use nested order item reads where available.

### `knowledge_base`

**Defined in:** `001_commerce_schema.sql` and separately in [`rag-setup.sql`](../rag-setup.sql)

**Purpose:** Original FAQ/policy knowledge table.

**Columns in migration `001`:**

- `id`
- `title`
- `content`
- `source_type`
- `category`
- `product_id`
- `metadata`
- timestamps

**Relationships:**

- `product_id -> products.id ON DELETE SET NULL`

**Usage:**

- Seeded with shipping, returns, payment, and customer-care records.
- Current runtime RAG does not query it. The active retrieval path queries `rag_documents` through `match_rag_documents()`.

**Schema inconsistency:** `rag-setup.sql` defines a lighter version without `metadata` and the product foreign key. Do not apply both definitions blindly.

### `conversation_state`

**Defined in:** `001_commerce_schema.sql`

**Purpose:** Stores the current workflow state and context for a WhatsApp number.

**Key columns:**

- `id`
- `whatsapp_number UNIQUE`
- `state`
- `context JSONB`
- `last_message`
- timestamps

**Allowed states:**

- `MAIN_MENU`
- `BROWSING_PRODUCTS`
- `VIEWING_CART`
- `CHECKOUT`
- `TRACK_ORDER`
- `CUSTOMER_CARE`

**Usage:**

- `upsertConversationState()` records branch transitions.
- RAG interactions may be stored through `logInteraction()` when `commerce.generateAnswer()` is used.
- It is workflow state, not a complete message transcript.

### `processed_webhook_events`

**Defined in:** `001_commerce_schema.sql`

**Purpose:** Deduplicates webhook event IDs.

**Key columns:**

- `id`
- `event_id UNIQUE`
- `event_type`
- `created_at`

**Usage:**

- Used by the legacy/local Razorpay handler in `index.ts`.
- The active `handleRazorpaySuccessWebhook()` implementation in `commerce.ts` does not use this table.
- WhatsApp message IDs are not persisted for deduplication.

### `rag_documents`

**Defined in:** `003_rag_pgvector.sql`

**Purpose:** Active vector store for PDF chunks and embeddings.

**Key columns:**

- `id`
- `source`
- `chunk_index`
- `content`
- `embedding VECTOR(1536)`
- `metadata JSONB`
- `created_at`
- unique `(source, chunk_index)`

**Indexes and functions:**

- HNSW cosine index `rag_documents_embedding_idx`
- source index
- RPC `match_rag_documents(query_embedding, match_count, match_threshold)`

**Usage:**

- Written by `scripts/ingest-pdf.ts`.
- Queried by `retrieveKnowledgeContext()` in `src/rag.ts`.

### `order_status_history`

**Defined in:** `004_order_status_history.sql`

**Purpose:** Append-only order status audit timeline.

**Columns:**

- `id`
- `order_id`
- `previous_status`
- `new_status`
- `changed_by`
- `changed_by_role`
- `reason`
- `metadata`
- `created_at`

**Relationships:** `order_id -> orders.id ON DELETE CASCADE`.

**Usage:** `updateOrderStatus()` inserts a row; `getOrderTimeline()` reads chronological history.

### `notification_events`

**Defined in:** `005_notification_events.sql`

**Purpose:** Queue and delivery audit records for order and support-ticket notifications.

**Columns:**

- `id`
- `order_id nullable`
- `customer_phone`
- `event_type`
- `channel`
- `status`: `queued`, `sent`, `failed`, `delivered`, or `skipped`
- `related_status`
- `payload JSONB`
- `reason`
- `created_at`
- `sent_at`
- `updated_at`

**Relationships:** `order_id -> orders.id ON DELETE SET NULL`.

**Usage:**

- `updateOrderStatus()` creates queued order events.
- Order status notification code sends WhatsApp messages and updates event state.
- Support-ticket status notifications reuse the same table with `event_type = support_ticket_status_changed` and store ticket identity in `payload`.

**Design caveat:** This table has no `ticket_id` column. Ticket notifications use `order_id` as nullable and identify the ticket through JSON payload. This works for the current implementation but is less relationally explicit than a dedicated ticket reference.

### `support_tickets`

**Defined in:** `007_support_tickets.sql`

**Purpose:** Customer-service issue records.

**Columns:**

- `id`
- `ticket_number UNIQUE`
- `customer_id nullable`
- `customer_phone`
- `order_id nullable`
- `issue_type`
- `priority`: `LOW`, `NORMAL`, `HIGH`, `URGENT`
- `status`: `OPEN`, `IN_PROGRESS`, `WAITING_CUSTOMER`, `RESOLVED`, `CLOSED`
- `created_at`
- `updated_at`
- `resolved_at`

**Relationships:**

- `customer_id -> customers.id ON DELETE SET NULL`
- `order_id -> orders.id ON DELETE SET NULL`
- Parent of `ticket_messages`

**Usage:**

- `createSupportTicket()` creates an `OPEN` ticket.
- `getSupportTicket()` reads by numeric ID.
- `getSupportTicketByNumber()` reads by public ticket number.
- `getCustomerTickets()` reads by phone.
- `getLatestCustomerSupportTicket()` filters customer tickets to active states.
- `updateSupportTicketStatus()` validates and updates status.

### `ticket_messages`

**Defined in:** `008_ticket_messages.sql` and extended by `009_ticket_message_media.sql`

**Purpose:** Conversation history for support tickets.

**Base columns:**

- `id`
- `ticket_id`
- `sender_type`: `AGENT` or `CUSTOMER`
- `message`
- `created_at`

**Media extension columns:**

- `message_type`: `TEXT` or `IMAGE`, default `TEXT`
- `media_id`
- `image_url`

Migration `009` makes `message` nullable so image-only rows can be stored.

**Relationships:** `ticket_id -> support_tickets.id ON DELETE CASCADE`.

**Usage:**

- Admin replies are sent to WhatsApp first and stored as `AGENT` messages after successful delivery.
- Customer text replies on active tickets are stored as `CUSTOMER/TEXT`.
- Customer image messages on active tickets are stored as `CUSTOMER/IMAGE` with media ID and optional URL.
- Admin message history returns both text and image fields chronologically.

### Functions and triggers

- `public.touch_updated_at()` updates `updated_at` on the original commerce tables.
- `public.touch_notification_event_updated_at()` updates notification event timestamps.
- `trg_support_tickets_updated_at` uses `touch_updated_at()`.
- `match_rag_documents()` performs vector similarity retrieval.

### Row-level security

The migrations enable RLS on commerce tables and add service-role management policies. Most application writes use the Supabase service-role key. Public/anonymous policies are not comprehensively defined, which is significant because product listing uses the anon key.

## 4. WhatsApp Flow

### Webhook entry and parsing

`POST /webhook` in `src/index.ts`:

1. Logs request method/path.
2. Parses JSON.
3. Extracts `body.entry[0].changes[0].value.messages[0]`.
4. Acknowledges status-only Meta events without `messages[0]`.
5. Extracts:
   - `message.from` as sender phone
   - `message.id` or a generated UUID
   - text body, lowercased and trimmed
   - interactive button reply ID
   - interactive list row ID
6. Schedules business processing through `ctx.waitUntil(...)`.
7. Returns `EVENT_RECEIVED` with HTTP 200.

There is no WhatsApp message-id persistence or deduplication in the current flow.

### Main menu

Messages `hi`, `hello`, `start`, and variants beginning with `hi ` or `hello` call `sendMainMenuButtons()`.

The menu contains three WhatsApp reply buttons:

- `VIEW_PRODUCTS`
- `TRACK_ORDER`
- `CUSTOMER_CARE`

The customer-care button currently enters ticket creation with `GENERAL_SUPPORT`.

### Product flow

`menu`, `VIEW_PRODUCTS`, and `ADD_MORE_PRODUCTS` call `sendProductList()`.

`sendProductList()`:

- Reads active/in-stock products using `SUPABASE_ANON_KEY`.
- Selects up to 10 products.
- Returns a WhatsApp interactive list.
- Uses row IDs formatted as `ADD_PRODUCT_<id>`.

Selecting a row:

- Parses the product ID.
- Calls `addItemToCart()`.
- Reads the cart.
- Sends cart action buttons.

### Cart flow

Supported actions:

- `VIEW_CART` or text `cart`: reads cart and sends items/total.
- `CLEAR_CART`: clears cart items and closes the cart.
- `ADD_MORE_PRODUCTS`: returns to product list.
- `CHECKOUT_CART`: starts checkout.

Commerce cart helpers in `commerce.ts` include:

- `getActiveCart()`
- `createCart()`
- `getCartItems()`
- `addItemToCart()`
- `removeItemFromCart()`
- `updateCartItemQuantity()`
- `viewCart()`
- `clearCart()`
- `calculateCartTotal()`

### Checkout flow

`CHECKOUT_CART` in the active WhatsApp route uses the commerce service path:

1. `createOrderFromCart(sender, env, messageId)`
2. `createCommercePaymentLink(order, env)`
3. `updateOrderPaymentLink(order.id, linkId, linkUrl, env)`
4. Sends the payment link to WhatsApp.

`createOrderFromCart()` creates an order with status `pending`, inserts order items, and marks the cart `checked_out`.

`updateOrderPaymentLink()` changes status to `payment_pending` and stores Razorpay link metadata.

### Payment flow

Payment confirmation is received through `POST /razorpay-webhook`.

The active route delegates to `handleRazorpaySuccessWebhook()` in `commerce.ts`, then sends a confirmation WhatsApp message when the result includes an order ID and customer phone.

### Order flow

Order tracking uses live Supabase data, not RAG.

Supported paths:

- Main menu `TRACK_ORDER`
- Text `track #123`
- Free-text order-status phrases involving order/status/track/shipped/delivered/payment

The tracking handlers:

1. Find the latest order or requested order ID for the sender phone.
2. Call `getOrderStatus()`.
3. Call `getOrderTimeline()`.
4. Create a customer-facing status message.

For missing orders the response is:

```text
No active orders found.
```

### Tracking status messages

Customer-facing lifecycle messages include:

- `paid`: `✅ Payment received.`
- `PACKED`: `📦 Order packed and awaiting shipment.`
- `SHIPPED`: `🚚 Order shipped.`
- `OUT_FOR_DELIVERY`: `🛵 Out for delivery.`
- `DELIVERED`: `✅ Delivered successfully.`

Legacy statuses are mapped to readable labels such as `Awaiting payment`, `Payment setup failed`, `Cancelled`, and `Completed`.

### Customer care and ticket creation

Customer Care is a structured support workflow rather than a RAG-only flow.

The bot recognizes support phrases for:

- refunds
- damaged/broken product or item
- wrong item
- replacement
- payment issue/problem
- human agent
- talk to support
- customer support

Intent classification occurs before RAG fallback. `processSupportRequest()`:

1. Looks up the latest order for the phone.
2. Resolves issue type.
3. Calls `createSupportTicket()`.
4. Sends a ticket confirmation containing ticket number, issue type, and `OPEN` status.

### Ticket status lookup

Recognized status phrases include:

- `track ticket`
- `ticket status`
- `my ticket`
- `support update`
- `complaint status`
- `check my ticket`

`getLatestCustomerSupportTicket()` filters by phone and active states:

- `OPEN`
- `IN_PROGRESS`
- `WAITING_CUSTOMER`

The response includes ticket number, issue type, status, and creation time. Resolved/closed tickets are not returned by the active lookup.

### Customer text threading

If a customer sends text while an active ticket exists, the message is stored as:

```text
sender_type = CUSTOMER
message_type = TEXT
```

The bot replies:

```text
✅ Message added to your support ticket.

Ticket Number: TKT-XXXX
```

This check occurs after explicit order and ticket-status commands but before support-ticket creation and RAG fallback. Therefore ordinary text from a customer with an active ticket is treated as a ticket reply.

### Customer image handling

If `message.image` exists:

1. The bot looks up the latest active ticket.
2. If found, it inserts a `CUSTOMER/IMAGE` row into `ticket_messages`.
3. It stores the WhatsApp image media ID and the payload URL if present.
4. It sends an image-received acknowledgement.
5. It returns from the async message handler.

If there is no active ticket, the image path returns false and processing continues. The current generic unsupported-message response may then be sent.

The bot does not download media from Meta, validate file type/size, virus-scan content, or persist the binary image. The stored `image_url` may be absent because WhatsApp payloads commonly provide a media ID rather than a directly usable public URL.

### Unknown text and unsupported messages

Unknown non-empty text reaches the RAG fallback. Non-text/non-image unsupported messages eventually receive:

```text
I can currently understand text messages and menu selections.

Send hi to open the main menu.
```

## 5. RAG System

### Components

- `src/rag.ts`: runtime RAG and OpenAI helper functions
- `scripts/ingest-pdf.ts`: local PDF ingestion
- `supabase/migrations/003_rag_pgvector.sql`: vector schema and RPC
- `rag_documents`: active vector store
- `match_rag_documents()`: similarity search RPC

### Embeddings

The embedding model is hard-coded as:

```text
text-embedding-3-small
```

The expected vector dimension is `1536`.

`embedTexts()`:

- Accepts batches of text.
- Uses a batch size of 96.
- Calls `POST https://api.openai.com/v1/embeddings`.
- Sorts returned vectors by provider index.

`embedQuery()` embeds one user question.

### PDF ingestion

Run with:

```bash
npm run ingest -- <path-to-pdf-or-directory>
```

Optional source override:

```bash
npm run ingest -- ./docs/file.pdf --source=policy.pdf
```

The script:

1. Loads `.env` through `dotenv/config`.
2. Accepts one PDF or all PDFs in a directory.
3. Extracts text with `pdf-parse`.
4. Skips empty/scanned PDFs with no extractable text.
5. Chunks text using the shared `chunkText()` implementation.
6. Embeds chunks with OpenAI.
7. Deletes existing `rag_documents` rows for the source.
8. Inserts replacement chunks with source/title/page metadata.

The replacement sequence is delete-then-insert, so a failed insert can temporarily leave a source without chunks.

### Chunking

`chunkText()`:

- Splits paragraphs on two or more newlines.
- Normalizes whitespace.
- Default chunk size: 1000 characters.
- Default overlap: 150 characters.
- Preserves overlap by carrying the tail of the previous chunk.

### Retrieval

`retrieveKnowledgeContext()`:

1. Trims the question.
2. Creates a service-role Supabase client.
3. Reads `RAG_MATCH_THRESHOLD` or defaults to `0.3`.
4. Embeds the query.
5. Calls `match_rag_documents()` with:
   - `match_count = 5`
   - configured threshold
6. Maps results into title/content/source/score objects.

The database RPC uses cosine similarity and returns rows meeting the threshold, ordered by closest vector distance.

### Generation

`generateAnswerFromContext()` builds a prompt that instructs the assistant to:

- answer only from supplied context
- state `I don't have enough verified information.` when context is insufficient
- not invent products, prices, stock, order details, payment status, or policies
- keep the response under 500 characters

The chat model defaults to `gpt-4o-mini`, overridable with `OPENAI_CHAT_MODEL`. The request uses:

- `max_tokens: 220`
- `temperature: 0.2`

### Confidence and fallback

- Empty retrieval result: fixed no-confidence response, no chat call.
- Retrieval RPC failure: logs the error and returns empty context.
- Chat failure: logs the error and returns the fixed no-confidence response.
- Successful answer: trimmed and limited to 500 characters.

### Knowledge-base distinction

`knowledge_base` is an older seeded table. The active Worker does not query it. Current FAQ retrieval depends on PDF ingestion into `rag_documents` and the vector RPC.

## 6. Order Management

### Order creation

The active checkout route uses `commerce.createOrderFromCart()`.

It:

- Finds the active cart by phone.
- Reads cart items.
- Calculates subtotal.
- Inserts an order with status `pending`.
- Inserts order items.
- Marks the cart `checked_out`.
- Reloads order items.

There is no database transaction spanning these operations.

### Payment statuses

Existing legacy/payment values:

- `pending`
- `payment_pending`
- `paid`
- `failed`
- `cancelled`
- `fulfilled`

### Fulfillment statuses

Added by migration `006`:

- `PACKED`
- `SHIPPED`
- `OUT_FOR_DELIVERY`
- `DELIVERED`

### Service layer

`commerce.ts` provides:

- `validateStatusTransition()`
- `getOrderStatus()`
- `updateOrderStatus()`
- `getOrderTimeline()`

`updateOrderStatus()`:

1. Reads the current order.
2. Validates the transition.
3. Performs an optimistic update using the previous status condition.
4. Inserts `order_status_history`.
5. Inserts a queued `notification_events` record.
6. Returns the updated order.

### Admin order status API

`POST /api/admin/orders/:id/status` accepts status and optional reason/admin fields. It authenticates with `ADMIN_API_TOKEN`, calls the order status service, sends order-status notification handling, and returns:

- updated order
- order timeline
- latest notification event

### Order notifications

Order status notifications are currently configured for:

- `PACKED`
- `SHIPPED`
- `OUT_FOR_DELIVERY`
- `DELIVERED`

The notification helper finds the queued event, sends through the common WhatsApp sender, updates it to `sent` with `sent_at`, or marks it `failed` with a reason. It logs lookup, send, Meta result, and state update details.

## 7. Razorpay Integration

### Checkout

`commerce.createRazorpayPaymentLink()` calls:

```text
POST https://api.razorpay.com/v1/payment_links
```

It uses HTTP Basic authentication created from:

- `RAZORPAY_KEY_ID`
- `RAZORPAY_KEY_SECRET`

The amount is converted from INR units to paise. The payload includes:

- order amount
- INR currency
- customer contact
- order reference
- order ID and customer phone notes

The response must include both `id` and `short_url`.

### Payment link persistence

`updateOrderPaymentLink()` stores:

- status `payment_pending`
- Razorpay link ID
- Razorpay short URL
- updated timestamp

### Webhook verification

`POST /razorpay-webhook` reads:

- raw request body
- `x-razorpay-signature`

`handleRazorpaySuccessWebhook()` computes HMAC-SHA256 with Web Crypto and performs a constant-time-like character comparison.

Only `payment_link.paid` is processed. Other events return `{ ok: true }` and are logged as ignored.

### Payment success flow

1. Validate signature.
2. Parse JSON.
3. Read payment-link ID and payment ID.
4. Find order by `razorpay_payment_link_id`.
5. Validate payment amount against `order.total_amount * 100`.
6. Update order to `paid`.
7. Store payment ID and `paid_at`.
8. Return order/customer/amount information to `index.ts`.
9. `index.ts` sends a WhatsApp confirmation.

### Failure paths

Failures include:

- missing/invalid signature
- invalid JSON
- missing payment-link ID
- missing order
- amount mismatch
- Supabase lookup/update failures
- WhatsApp outbound failure after payment update

The code has two Razorpay-related implementations: the active `commerce.ts` handler and older/local handler code in `index.ts`. The active `/razorpay-webhook` route delegates to the commerce implementation.

### Idempotency caveat

The active commerce webhook handler does not use `processed_webhook_events` and does not explicitly guard already-paid orders before updating. Duplicate webhook handling should be reviewed before production scaling.

## 8. Support Ticket System

### Ticket schema

`support_tickets` stores customer issues with:

- public `ticket_number`
- customer phone and optional customer ID
- optional order ID
- issue type
- priority
- status
- resolution timestamp

### Intent detection

Support intent detection is rule-based and occurs inside the WhatsApp handler.

Supported categories include:

- refund
- damaged/broken product or item
- wrong item/product
- replacement
- payment issue/problem
- human agent request
- talk to support
- customer support

Damage detection uses product context and recognizes terms such as:

- broke
- broken
- damaged

The classifier resolves these to `DAMAGED_PRODUCT`.

### Ticket creation

`processSupportRequest()`:

1. Finds the latest order for the sender phone if present.
2. Resolves issue type.
3. Calls `createSupportTicket()`.
4. Creates status `OPEN`.
5. Sends the ticket number and issue type to WhatsApp.

Ticket number format is generated as:

```text
TKT-<timestamp>-<random suffix>
```

### Ticket lookup

Service functions:

- `getSupportTicket(ticketId)`
- `getSupportTicketByNumber(ticketNumber)`
- `getCustomerTickets(customerPhone)`
- `getLatestCustomerSupportTicket(phoneNumber)`

The latest-customer helper considers only:

- `OPEN`
- `IN_PROGRESS`
- `WAITING_CUSTOMER`

### Ticket status flow

Allowed statuses:

- `OPEN`
- `IN_PROGRESS`
- `WAITING_CUSTOMER`
- `RESOLVED`
- `CLOSED`

Current transition map:

```text
OPEN -> IN_PROGRESS | WAITING_CUSTOMER | RESOLVED | CLOSED
IN_PROGRESS -> WAITING_CUSTOMER | RESOLVED | CLOSED
WAITING_CUSTOMER -> IN_PROGRESS | RESOLVED | CLOSED
RESOLVED -> IN_PROGRESS | CLOSED
CLOSED -> terminal
```

`updateSupportTicketStatus()` validates runtime status values, applies optimistic status matching, sets `resolved_at` for `RESOLVED`/`CLOSED`, and writes structured logs.

### Admin ticket workflow

Admins can:

- list tickets
- read one ticket
- update ticket status
- send a reply through WhatsApp
- read ticket messages

Admin authentication uses exact bearer-token comparison against `ADMIN_API_TOKEN`.

### Support status notifications

For these transitions, the admin status API creates a notification event and sends WhatsApp:

- `OPEN -> IN_PROGRESS`
- `OPEN -> WAITING_CUSTOMER`
- `IN_PROGRESS -> RESOLVED`
- `RESOLVED -> CLOSED`

The notification event uses `event_type = support_ticket_status_changed` and stores ticket data in JSON payload. Duplicate queued/sent events for the same transition are skipped.

### Conversation history

`ticket_messages` combines agent and customer messages:

- Admin replies: `AGENT`
- Customer text replies: `CUSTOMER`, `message_type = TEXT`
- Customer images: `CUSTOMER`, `message_type = IMAGE`

Admin replies are sent to WhatsApp before insertion. This ensures failed WhatsApp delivery does not create a stored agent message.

Customer replies are inserted before the bot acknowledgment is sent. If acknowledgment delivery fails, the message may still be present in history.

### Image attachments

Incoming WhatsApp image payloads are checked against the latest active ticket. Image entries store:

- `ticket_id`
- `sender_type = CUSTOMER`
- `message_type = IMAGE`
- `media_id`
- optional `image_url`
- `message = NULL`

The current implementation does not download media from Meta or store binary content.

## 9. Admin APIs

All `/api/admin/*` routes require:

```http
Authorization: Bearer <ADMIN_API_TOKEN>
```

If `ADMIN_API_TOKEN` is not configured, admin routes return HTTP 503. If the token is missing or incorrect, they return HTTP 401.

### `POST /api/admin/orders/:id/status`

**Purpose:** Update an order lifecycle status.

**Request body:**

```json
{
  "status": "PACKED",
  "reason": "Order packed by warehouse",
  "changed_by": "admin-api",
  "changed_by_role": "admin"
}
```

**Behavior:** Validates order existence, calls `updateOrderStatus()`, sends order status notification handling, reads timeline and notification event.

**Response:**

```json
{
  "order": {},
  "timeline": [],
  "notification_event": {}
}
```

### `GET /api/admin/orders/customer/phone/:phone`

**Purpose:** List all orders matching a customer's phone number, newest first. The phone path parameter is normalized to digits and must contain 8–15 digits after normalization. This route queries `orders.customer_phone` and does not rely on `customer_id`.

**Response:**

```json
{
  "success": true,
  "customerPhone": "916280316170",
  "count": 1,
  "orders": []
}
```

An empty result returns the same structure with `count: 0` and `orders: []`. Results are paged from Supabase so all matching orders are included.

### `GET /api/admin/orders/:orderId`

**Purpose:** Read one order by the numeric `orders.id` primary key.

**Response:** `{ "success": true, "order": {} }`.

Returns HTTP 404 with `{ "success": false, "error": "Order not found" }` when no order exists. Invalid or non-positive IDs return HTTP 400. This route uses the same admin bearer-token authentication as the other `/api/admin/*` endpoints.

### `GET /api/admin/tickets`

**Purpose:** List tickets newest first.

**Request body:** None.

**Response fields per ticket:**

- `id`
- `ticket_number`
- `order_id`
- `issue_type`
- `status`
- `created_at`

### `GET /api/admin/tickets/:id`

**Purpose:** Read one ticket.

**Request body:** None.

**404:** `Support ticket not found`.

**Response:** A `ticket` object containing ID, ticket number, order ID, issue type, status, and created timestamp.

### `PATCH /api/admin/tickets/:id/status`

**Purpose:** Update a support ticket status.

**Request body:**

```json
{
  "status": "IN_PROGRESS"
}
```

**Allowed statuses:** `OPEN`, `IN_PROGRESS`, `WAITING_CUSTOMER`, `RESOLVED`, `CLOSED`.

**Response:** Updated ticket summary.

**Side effects:** Status notification event and WhatsApp notification for supported transitions.

### `POST /api/admin/tickets/:id/reply`

**Purpose:** Send an agent reply to the ticket owner.

**Request body:**

```json
{
  "message": "Please share photos of the damaged product."
}
```

**Behavior:** Finds ticket, sends the formatted WhatsApp message, then stores an `AGENT` row in `ticket_messages`.

**Response:** HTTP 201 with stored message.

**Failure behavior:** If WhatsApp sending fails, the message is not stored and the route returns HTTP 500.

### `GET /api/admin/tickets/:id/messages`

**Purpose:** Read ticket conversation history.

**Request body:** None.

**Response:** Chronologically ordered messages containing:

- `id`
- `ticket_id`
- `sender_type`
- `message`
- `message_type`
- `media_id`
- `image_url`
- `created_at`

### Non-admin operational routes

| Method | Route | Purpose |
|---|---|---|
| GET | `/message` | Starter health/demo response `Hello, World!` |
| GET | `/random` | Starter UUID response |
| GET | `/ai-test` | Direct RAG/OpenAI test route |
| GET | `/webhook` | Meta webhook verification |
| POST | `/webhook` | WhatsApp inbound event handler |
| POST | `/razorpay-webhook` | Razorpay payment webhook |

## 10. Customer Support Categories

### `REFUND`

Examples:

- `refund`
- `refund my order`
- `I want a refund`

### `DAMAGED_PRODUCT`

Examples:

- `damaged product`
- `damaged item`
- `product is damaged`
- `item is damaged`
- `broken product`
- `broken item`
- `product is broken`
- `item is broken`
- `my product is damaged`
- `my product is broken`
- `received damaged product`
- `received broken product`
- product-context uses of `broke`, `broken`, or `damaged`

### `WRONG_ITEM`

Examples:

- `wrong item`
- `wrong product`

### `PAYMENT_ISSUE`

Examples:

- `payment issue`
- `payment problem`

### `HUMAN_AGENT`

Examples:

- `need a human agent`
- `talk to support`

### `GENERAL_SUPPORT`

Examples:

- `customer support`
- Customer Care menu button
- Other ticket-creation support requests that do not match a narrower category

### Ticket status lookup intents

These are not ticket creation categories:

- `track ticket`
- `ticket status`
- `my ticket`
- `support update`
- `complaint status`
- `check my ticket`

## 11. Current Working Features

### Runtime and routing

- [x] Cloudflare Worker entrypoint configured
- [x] Meta GET webhook verification
- [x] WhatsApp POST webhook parsing
- [x] Async processing using `ctx.waitUntil`
- [x] Shared outbound WhatsApp sender
- [x] Structured operational logs

### Commerce

- [x] Product listing
- [x] Product selection
- [x] Active carts
- [x] Add/remove/update cart items
- [x] Cart totals
- [x] Cart clearing
- [x] Multi-item order creation
- [x] Razorpay payment-link creation
- [x] Razorpay payment success webhook
- [x] Live order status lookup
- [x] Order status history
- [x] Admin order status API
- [x] Order-status WhatsApp notifications

### RAG

- [x] PDF parsing
- [x] Paragraph chunking with overlap
- [x] OpenAI embeddings
- [x] pgvector storage
- [x] Similarity-search RPC
- [x] OpenAI answer generation
- [x] Fixed low-confidence fallback
- [x] RAG test coverage for helper functions

### Customer support

- [x] Rule-based support intent detection
- [x] Support issue classification
- [x] Ticket creation
- [x] Active ticket lookup
- [x] Ticket status lookup in WhatsApp
- [x] Ticket status service layer
- [x] Admin ticket list/detail APIs
- [x] Admin ticket status API
- [x] Support ticket status notifications
- [x] Admin WhatsApp replies
- [x] Customer text threading
- [x] Customer image entries
- [x] Combined agent/customer/image history API

## 12. Current Limitations, Bugs, Shortcuts, and Technical Debt

### High-priority schema/runtime risks

1. **Legacy order schema mismatch:** Some code in `index.ts` uses `product_id`, `product_name`, `quantity`, `unit_price`, and `amount`, but the fresh migration chain does not consistently create all of these columns. Verify the actual production schema.
2. **Two order implementations coexist:** The active route uses `commerce.ts`, while older local order/payment functions remain in `index.ts`. This increases maintenance and regression risk.
3. **Ticket notification relational model is incomplete:** `notification_events` has `order_id` but no `ticket_id`; support notifications store ticket identity in JSON payload.
4. **No database transactions:** Checkout, order-items insertion, cart closure, payment-link update, ticket history, and notification event creation are separate operations.
5. **No WhatsApp inbound deduplication:** Meta retries can duplicate cart additions, ticket creation, customer replies, or image rows.

### Security and privacy

6. **Webhook verification token is hard-coded:** `VERIFY_TOKEN = "whatsapp-bot-secret-123"` is not an environment secret.
7. **Admin authentication is a single shared bearer token:** No users, roles, expiry, rotation, or audit identity are implemented.
8. **Sensitive logs:** Phone numbers, payloads, external responses, and potentially tokens-related request context are logged broadly.
9. **RLS policy surface is incomplete:** Most migrations only define service-role policies. Anon product reads may fail or require policies configured outside the repository.
10. **No customer authentication beyond phone number:** Customer identity is inferred from Meta's `message.from` value.

### Support limitations

11. **Image binaries are not persisted:** Only media ID and optional payload URL are stored.
12. **No Meta media download:** The stored URL may not be usable for later access.
13. **No message delivery status for ticket history:** Agent message is stored after send, but WhatsApp delivery/read receipts are not linked to message rows.
14. **Customer reply ordering is asymmetric:** Customer text/image rows can be written before acknowledgement delivery, while agent rows are written after outbound delivery.
15. **No ticket message pagination:** Admin history reads all messages.
16. **No agent identity field on ticket messages:** `sender_type` distinguishes agent/customer but not which agent acted.
17. **No ticket assignment, SLA, priority workflow, or internal notes.**
18. **Ticket status transition map is broader than the notification transition list:** Some legal status changes do not trigger ticket notifications.

### Commerce and payment limitations

19. **Stock is checked but not reserved/decremented:** Concurrent purchases can oversell.
20. **Payment webhook idempotency is incomplete in active commerce handler.**
21. **Payment and order operations lack transactional compensation.**
22. **Legacy `processBuyCommand()` remains in the Worker.**
23. **Razorpay failure handling is mostly error response/logging; there is no complete retry/reconciliation workflow.**

### RAG limitations

24. **`knowledge_base` is not active retrieval storage.**
25. **RAG threshold documentation differs:** source default is `0.3`; example env uses `0.75`.
26. **Retrieval failures collapse to no-confidence behavior.**
27. **No evaluation set for answer quality, citation/source display, or hallucination monitoring.**
28. **PDF ingestion deletes a source before inserting its replacement chunks.**

### Testing and operations

29. **Tests are starter tests:** They cover `/message`, `/random`, and RAG helper behavior, not commerce or support flows.
30. **No Supabase integration tests:** Database constraints, RLS, migrations, and RPCs are not tested in CI.
31. **No WhatsApp contract tests:** Meta payload parsing and outbound payloads are not systematically tested.
32. **No admin API tests:** Authentication, 404/400 behavior, status transitions, notifications, and replies lack automated coverage.
33. **No migration command in `package.json`:** Migrations must be applied externally.
34. **Static UI is still Cloudflare starter content.**
35. **No production runbook or secret provisioning script is committed.**
36. **No rate limiting, queue, retry worker, or dead-letter handling exists.**

## 13. Recently Added Features

The customer-care system was built incrementally on top of the commerce Worker.

### Order lifecycle management

- Added `order_status_history`.
- Added fulfillment statuses while preserving legacy payment statuses.
- Added order status transition validation.
- Added order timeline reads.
- Added admin order status API.

### Order notifications

- Added `notification_events`.
- Added WhatsApp notifications for fulfillment statuses.
- Added sent/failed state tracking and timestamps.
- Added duplicate prevention for order notification events.

### Support tickets

- Added `support_tickets` schema.
- Added ticket creation and lookup services.
- Added ticket status constants and transition validation.
- Added structured ticket status logs.
- Added support intent routing and issue classification.
- Added natural-language damaged/broken product detection.

### Admin ticket APIs

- Added authenticated ticket list and detail endpoints.
- Added ticket status update endpoint.
- Added authenticated agent reply endpoint.
- Added chronological ticket message history endpoint.

### Ticket notifications

- Added support ticket status notifications for selected transitions.
- Reused `notification_events` and the shared WhatsApp sender.
- Added duplicate notification checks.

### Conversation threading

- Customer text replies on active tickets are stored in `ticket_messages`.
- Customer image messages on active tickets are stored with media metadata.
- Admin history includes agent and customer text/image entries.

## 14. Environment Variables

### Cloudflare Worker binding

`AI`

- Declared in `wrangler.jsonc`.
- Required by the handwritten `Env`/`RAGEnv` types.
- Current RAG answer generation uses OpenAI directly rather than `env.AI`.

### Supabase

`SUPABASE_URL`

- Supabase project URL.
- Used by both admin and public clients.

`SUPABASE_ANON_KEY`

- Public/anon Supabase key.
- Used by `getPublicClient()` for product listing.

`SUPABASE_SERVICE_ROLE_KEY`

- Privileged Supabase key.
- Used by `getAdminClient()` for orders, carts, customers, tickets, notifications, and RAG retrieval.
- Must never be exposed to clients.

### WhatsApp

`WHATSAPP_TOKEN`

- Meta Graph API bearer token for outbound messages.

`PHONE_NUMBER_ID`

- Meta WhatsApp Business phone-number ID used in:

```text
https://graph.facebook.com/v21.0/{PHONE_NUMBER_ID}/messages
```

### Razorpay

`RAZORPAY_KEY_ID`

- Public identifier used to create payment links.

`RAZORPAY_KEY_SECRET`

- Basic-auth secret for Razorpay API calls.

`RAZORPAY_WEBHOOK_SECRET`

- HMAC verification secret for Razorpay webhook signatures.

### OpenAI

`OPENAI_API_KEY`

- Used for embeddings and chat completions.

`OPENAI_CHAT_MODEL` optional

- Overrides default `gpt-4o-mini`.

`RAG_MATCH_THRESHOLD` optional

- Numeric similarity threshold passed to the vector RPC.
- Runtime fallback is `0.3`.
- Example dev configuration currently shows `0.75`.

### Admin

`ADMIN_API_TOKEN` optional in the TypeScript interface but operationally required for admin APIs.

- Compared against `Authorization: Bearer <token>`.
- Missing configuration produces HTTP 503 on admin routes.
- Missing or invalid token produces HTTP 401.
- `.dev.vars.example` does not currently list this variable and should be updated before onboarding another developer.

### Hard-coded configuration

`VERIFY_TOKEN`

- Current value: `whatsapp-bot-secret-123`.
- Used for Meta GET webhook verification.
- Not an environment variable today.

### Ingestion-only environment

`scripts/ingest-pdf.ts` requires:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `OPENAI_API_KEY`

These are loaded from the shell or `.env` through `dotenv/config`.

## 15. Deployment

### Wrangler configuration

[`wrangler.jsonc`](../wrangler.jsonc) configures:

- Worker name: `whatsapp-bot`
- Entrypoint: `src/index.ts`
- Compatibility date: `2026-07-29`
- `AI` binding
- `nodejs_compat`
- `global_fetch_strictly_public`
- static assets directory `./public`
- observability enabled
- source-map upload enabled

Secrets and environment values are not configured in the checked-in Wrangler file. They must be provisioned separately through Wrangler or the Cloudflare dashboard.

### Local development

```bash
npm install
npm run dev
```

Equivalent command:

```bash
wrangler dev
```

Populate local Worker variables through `.dev.vars`. The current example should include all runtime variables, including `ADMIN_API_TOKEN`, before use.

### Type generation

After changing Worker bindings:

```bash
npm run cf-typegen
```

This runs `wrangler types`.

### Deployment

```bash
npm run deploy
```

Equivalent:

```bash
wrangler deploy
```

Before deployment:

1. Confirm production secrets are configured.
2. Confirm Meta callback URL points to the deployed Worker hostname and `/webhook` path.
3. Confirm Meta WhatsApp `messages` subscription is enabled.
4. Apply Supabase migrations `001` through `009` in order, using the actual production schema as the source of truth.
5. Confirm Razorpay webhook points to `/razorpay-webhook`.
6. Test GET webhook verification.
7. Test an inbound WhatsApp message and inspect Worker tail logs.
8. Verify outbound Graph API responses.

### Supabase setup

The repository does not define a migration script. Apply SQL through Supabase SQL editor, Supabase CLI, or the selected migration workflow. Do not re-run historical migrations blindly against an existing database without checking constraints and legacy columns.

Recommended migration order:

```text
001_commerce_schema.sql
002_fix_orders_schema.sql
003_rag_pgvector.sql
004_order_status_history.sql
005_notification_events.sql
006_status_constraint_updates.sql
007_support_tickets.sql
008_ticket_messages.sql
009_ticket_message_media.sql
```

### Meta WhatsApp setup

Required Meta configuration:

- callback URL: `https://<worker-host>/webhook`
- verify token: current code expects the hard-coded `VERIFY_TOKEN`
- subscribed field: `messages`
- access token in `WHATSAPP_TOKEN`
- business phone ID in `PHONE_NUMBER_ID`

WhatsApp inbound events are acknowledged quickly. Business processing happens in `ctx.waitUntil`, so tail logs must be inspected after the HTTP acknowledgement.

### Production observability

The Worker has Cloudflare observability enabled and logs detailed request, branch, Supabase, Meta, payment, ticket, and notification data. Because logs contain customer phone numbers and payloads, production log retention and access should be reviewed.

## 16. Recommended Next Development Phase

### Priority 1: Establish production correctness tests

Build integration tests for:

- POST `/webhook` text, button, list, image, status-only, malformed JSON
- support intent classification and active-ticket threading
- order tracking and status transitions
- admin authentication and all admin routes
- notification sent/failed/duplicate behavior
- Razorpay signature and amount validation
- Supabase constraints and RLS

Why: the current test suite validates only starter routes and RAG helpers, leaving the main business system unprotected.

### Priority 2: Unify the order implementation

Remove or isolate the duplicate legacy order/payment code in `index.ts`. Keep one authoritative implementation in `commerce.ts` and one route-level orchestration layer.

Why: current duplicate paths create schema drift and make payment/order behavior difficult to reason about.

### Priority 3: Reconcile the production schema

Inspect the live `orders` table and create an explicit migration for any legacy columns still required. Decide whether to retain compatibility columns or remove old code paths.

Why: the migration chain and runtime code currently describe overlapping order models.

### Priority 4: Make webhook processing idempotent

Persist inbound WhatsApp message IDs and enforce uniqueness before processing. Extend webhook event deduplication to all providers and message types.

Why: Meta and payment providers retry events; current asynchronous processing can duplicate actions.

### Priority 5: Move outbound notifications to a queue

Use a durable queue or equivalent worker pattern for WhatsApp notifications. Add retry count, last error, next attempt, and dead-letter handling.

Why: current notification sends occur inline and can couple admin API latency/failure to external API behavior.

### Priority 6: Improve media handling

Resolve the WhatsApp media ID through the Meta media API, download to durable object storage, validate MIME/size, scan content, and store a durable object reference rather than relying on a provider URL.

### Priority 7: Complete support operations

Add:

- ticket assignment
- agent identity
- internal notes
- message delivery/read status
- ticket audit history
- pagination/search/filtering
- SLA and priority rules
- customer-facing ticket number lookup

### Priority 8: Harden configuration and security

- Move `VERIFY_TOKEN` to a secret.
- Document `ADMIN_API_TOKEN`.
- Replace shared-token admin auth with identity/role-based auth.
- Reduce sensitive logs.
- Add explicit RLS policies for intended anonymous reads.
- Rotate credentials and document secret ownership.

### Priority 9: Add RAG evaluation and source controls

- Define a source metadata policy.
- Add retrieval and answer evaluation cases.
- Make threshold configuration explicit and consistent.
- Consider whether `knowledge_base` should be retired or integrated.

## 17. Architecture Diagram

### Commerce flow

```text
WhatsApp customer
    |
    v
POST /webhook
    |
    +--> VIEW_PRODUCTS/menu
    |       |
    |       v
    |   Supabase products
    |       |
    |       v
    |   WhatsApp interactive product list
    |
    +--> ADD_PRODUCT_<id>
    |       |
    |       v
    |   products -> carts -> cart_items
    |
    +--> VIEW_CART / cart
    |       |
    |       v
    |   Supabase cart/cart_items -> WhatsApp summary
    |
    +--> CHECKOUT_CART
            |
            v
        createOrderFromCart
            |
            +--> orders
            +--> order_items
            +--> carts.status = checked_out
            +--> Razorpay payment link
```

### Payment flow

```text
Customer checkout
    |
    v
commerce.createRazorpayPaymentLink()
    |
    v
Razorpay Payment Link API
    |
    v
updateOrderPaymentLink()
orders.status = payment_pending
    |
    v
Customer pays through Razorpay
    |
    v
POST /razorpay-webhook
    |
    v
HMAC signature verification
    |
    v
Find order by razorpay_payment_link_id
    |
    v
Validate amount
    |
    v
orders.status = paid
paid_at/payment ID saved
    |
    v
WhatsApp payment confirmation
```

### Order flow

```text
Order created: pending
        |
        v
Payment link: payment_pending
        |
        v
Payment confirmed: paid
        |
        v
Admin status API
        |
        +--> PACKED
                |
                v
            SHIPPED
                |
                v
            OUT_FOR_DELIVERY
                |
                v
            DELIVERED

Every service-layer status update:
orders update
    +--> order_status_history append
    +--> notification_events queued
    +--> WhatsApp notification for configured fulfillment states
```

### Customer support flow

```text
WhatsApp message
    |
    v
POST /webhook
    |
    +--> ticket-status phrase
    |       |
    |       v
    |   latest active support ticket lookup
    |       |
    |       v
    |   status response
    |
    +--> active ticket + text
    |       |
    |       v
    |   ticket_messages CUSTOMER/TEXT
    |       |
    |       v
    |   acknowledgement
    |
    +--> active ticket + image
    |       |
    |       v
    |   ticket_messages CUSTOMER/IMAGE
    |       |
    |       v
    |   image acknowledgement
    |
    +--> support intent
    |       |
    |       v
    |   latest order lookup
    |       |
    |       v
    |   support_tickets OPEN
    |       |
    |       v
    |   ticket confirmation
    |
    +--> unknown text
            |
            v
        RAG fallback

Admin
    |
    +--> GET ticket/list/detail/messages
    +--> PATCH ticket status
    |       |
    |       +--> notification event
    |       +--> WhatsApp ticket update
    |
    +--> POST ticket reply
            |
            +--> WhatsApp agent message
            +--> ticket_messages AGENT
```

## 18. Complete Project Summary

### One-paragraph handover

This is a TypeScript Cloudflare Worker named `whatsapp-bot` that receives Meta WhatsApp webhook events at `POST /webhook`, routes commerce/support intents, persists commerce and customer-service state in Supabase, uses Razorpay for payment links and payment confirmation, and uses OpenAI plus Supabase pgvector for PDF FAQ RAG. The main controller is `src/index.ts`; reusable persistence and domain services are in `src/commerce.ts`; RAG is in `src/rag.ts`; PDF ingestion is `scripts/ingest-pdf.ts`; database migrations are `supabase/migrations/001` through `009`. The system has working product/cart/order/payment/support/admin flows, but business-flow test coverage is minimal and there are verified schema/code overlaps that should be resolved before significant expansion.

### Files to read first in a new session

1. [`src/index.ts`](../src/index.ts): all routes, WhatsApp branches, outbound messaging, admin APIs, Razorpay route.
2. [`src/commerce.ts`](../src/commerce.ts): service functions, Supabase queries, order/ticket status logic, payment handler.
3. [`src/rag.ts`](../src/rag.ts): embeddings, retrieval, prompts, OpenAI chat generation.
4. [`supabase/migrations/001_commerce_schema.sql`](../supabase/migrations/001_commerce_schema.sql): base commerce schema.
5. [`supabase/migrations/002_fix_orders_schema.sql`](../supabase/migrations/002_fix_orders_schema.sql): legacy order compatibility adjustment.
6. [`supabase/migrations/003_rag_pgvector.sql`](../supabase/migrations/003_rag_pgvector.sql): active vector schema and RPC.
7. [`supabase/migrations/004_order_status_history.sql`](../supabase/migrations/004_order_status_history.sql) through [`009_ticket_message_media.sql`](../supabase/migrations/009_ticket_message_media.sql): lifecycle, notifications, support, message, and image additions.
8. [`package.json`](../package.json): commands and dependencies.
9. [`wrangler.jsonc`](../wrangler.jsonc): Worker entrypoint, binding, assets, observability.
10. [`test/index.spec.ts`](../test/index.spec.ts) and [`src/rag.spec.ts`](../src/rag.spec.ts): current test coverage and its gaps.

### Commands

```bash
npm install
npm run dev
npm test
npm run cf-typegen
npm run ingest -- <path-to-pdf-or-directory>
npm run deploy
```

### Immediate continuation checklist for another AI agent

1. Confirm the actual production Supabase schema, especially `orders` legacy columns.
2. Confirm migrations `001` through `009` have been applied in the intended environment.
3. Add `ADMIN_API_TOKEN` to local and deployment secret documentation.
4. Add integration tests for `/webhook`, admin ticket APIs, order APIs, notifications, and ticket messages.
5. Add WhatsApp message-id idempotency before modifying more intent logic.
6. Decide whether to unify or remove the duplicate legacy order/payment code in `index.ts`.
7. Treat RAG as FAQ-only; continue using live database queries for order and ticket facts.
8. Treat `ticket_messages` as the support conversation source, with `message_type = TEXT|IMAGE` and nullable text for image rows.
9. Do not assume `image_url` is durable; resolve Meta media IDs for production media handling.
10. Preserve the current admin bearer-token contract until a deliberate authentication migration is planned.

### Current trust boundaries

- Meta identifies the WhatsApp sender using `message.from`.
- Supabase service-role access bypasses normal user RLS and is used by the Worker for sensitive operations.
- Admin APIs trust one shared `ADMIN_API_TOKEN`.
- OpenAI answers are constrained by retrieved context but are not independently evaluated or cited.
- Order status and ticket status responses should remain database-driven and should not be answered by RAG.

### Handover conclusion

The project is beyond an FAQ prototype: it is a monolithic commerce Worker with a growing support-ticket domain. The next developer should prioritize correctness infrastructure, schema reconciliation, idempotency, security, and integration tests before adding more customer-facing workflows. The existing service boundaries in `commerce.ts` are the preferred place for new domain operations; `index.ts` should remain a thin route and intent orchestration layer as the system is gradually refactored.
