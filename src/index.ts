// Hey bot
import {
	createClient,
	SupabaseClient,
} from "@supabase/supabase-js";

interface Env {
	AI: Ai;
	SUPABASE_URL: string;
	SUPABASE_ANON_KEY: string;
	SUPABASE_SERVICE_ROLE_KEY: string;

	WHATSAPP_TOKEN: string;
	PHONE_NUMBER_ID: string;

	RAZORPAY_KEY_ID: string;
	RAZORPAY_KEY_SECRET: string;
	RAZORPAY_WEBHOOK_SECRET: string;
}

interface Product {
	id: number;
	name: string;
	price: number;
	description: string | null;
	stock: number;
}

interface Order {
	id: number;
	customer_phone: string;
	product_id: number;
	product_name: string;
	quantity: number;
	unit_price: number;
	total_amount: number;
	status: string;
	razorpay_payment_link_id: string | null;
	razorpay_payment_link_url: string | null;
	razorpay_payment_id: string | null;
	created_at: string;
	updated_at: string;
	paid_at: string | null;
}

interface Cart {
	id: number;
	customer_phone: string;
	status: string;
	created_at: string;
	updated_at: string;
}

interface CartItem {
	id: number;
	cart_id: number;
	product_id: number;
	product_name: string;
	unit_price: number;
	quantity: number;
}

interface RazorpayPaymentLink {
	id: string;
	short_url: string;
}
interface AITextResponse {
	response?: string;
}
interface ExistingOrder {
	id: number;
	razorpay_payment_link_url: string | null;
}

interface ExistingCartItem {
	id: number;
	quantity: number;
}
interface AITextResponse {

    response?: string;

}

const VERIFY_TOKEN = "whatsapp-bot-secret-123";

/*
|--------------------------------------------------------------------------
| Supabase clients - test msg
|--------------------------------------------------------------------------
*/

function getAdminClient(env: Env): SupabaseClient {
	return createClient(
		env.SUPABASE_URL,
		env.SUPABASE_SERVICE_ROLE_KEY,
		{
			auth: {
				persistSession: false,
				autoRefreshToken: false,
			},
		}
	);
}

function getPublicClient(env: Env): SupabaseClient {
	return createClient(
		env.SUPABASE_URL,
		env.SUPABASE_ANON_KEY,
		{
			auth: {
				persistSession: false,
				autoRefreshToken: false,
			},
		}
	);
}

/*
|--------------------------------------------------------------------------
| WhatsApp API helpers
|--------------------------------------------------------------------------
*/

async function sendWhatsAppPayload(
	payload: Record<string, unknown>,
	env: Env
): Promise<void> {
	const apiUrl =
		`https://graph.facebook.com/v21.0/${env.PHONE_NUMBER_ID}/messages`;

	const response = await fetch(apiUrl, {
		method: "POST",
		headers: {
			Authorization: `Bearer ${env.WHATSAPP_TOKEN}`,
			"Content-Type": "application/json",
		},
		body: JSON.stringify(payload),
	});

	const result = await response.text();

	if (!response.ok) {
		console.error(
			"WhatsApp API failed:",
			response.status,
			result
		);

		throw new Error(
			`WhatsApp API request failed with status ${response.status}`
		);
	}

	console.log(
		"WhatsApp API request succeeded:",
		result
	);
}

async function sendWhatsAppMessage(
	to: string,
	message: string,
	env: Env
): Promise<void> {
	await sendWhatsAppPayload(
		{
			messaging_product: "whatsapp",
			recipient_type: "individual",
			to,
			type: "text",
			text: {
				preview_url: true,
				body: message,
			},
		},
		env
	);
}

/*
|--------------------------------------------------------------------------
| Main menu
|--------------------------------------------------------------------------
*/

async function sendMainMenuButtons(
	to: string,
	env: Env
): Promise<void> {
	await sendWhatsAppPayload(
		{
			messaging_product: "whatsapp",
			recipient_type: "individual",
			to,
			type: "interactive",
			interactive: {
				type: "button",
				header: {
					type: "text",
					text: "Innova Solutions",
				},
				body: {
					text: [
						"Welcome to Innova Solutions!",
						"",
						"How can we help you today?",
					].join("\n"),
				},
				footer: {
					text: "Select one option below",
				},
				action: {
					buttons: [
						{
							type: "reply",
							reply: {
								id: "VIEW_PRODUCTS",
								title: "View Products",
							},
						},
						{
							type: "reply",
							reply: {
								id: "TRACK_ORDER",
								title: "Track Order",
							},
						},
						{
							type: "reply",
							reply: {
								id: "CUSTOMER_CARE",
								title: "Customer Care",
							},
						},
					],
				},
			},
		},
		env
	);

	console.log("Interactive main menu sent");
}

/*
|--------------------------------------------------------------------------
| Customer Care template
|--------------------------------------------------------------------------
|
| This requires an approved Meta template:
|
| Name: innova_customer_care
| Language code: en
| CTA: Call phone number
| Phone: +914023393703
|
|--------------------------------------------------------------------------
*/

async function sendCustomerCareMessage(
	to: string,
	env: Env
): Promise<void> {
	await sendWhatsAppMessage(
		to,
		[
			"☎️ Innova Solutions Customer Care",
			"",
			"Tap the link below to call:",
			"tel:+914023393703",
			"",
			"Customer Care: +91 40 2339 3703",
		].join("\n"),
		env
	);

	console.log(
		"Customer Care number sent"
	);
}

/*
|--------------------------------------------------------------------------
| Product list
|--------------------------------------------------------------------------
*/

async function sendProductList(
	to: string,
	env: Env
): Promise<void> {
	const supabase = getPublicClient(env);

	const { data, error } = await supabase
		.from("products")
		.select(
			"id, name, price, description, stock"
		)
		.gt("stock", 0)
		.order("id", {
			ascending: true,
		})
		.limit(10);

	if (error) {
		console.error(
			"Product list query failed:",
			error
		);

		await sendWhatsAppMessage(
			to,
			[
				"Sorry, products could not be loaded.",
				"Please try again shortly.",
			].join("\n"),
			env
		);

		return;
	}

	const products =
		(data ?? []) as unknown as Product[];

	if (products.length === 0) {
		await sendWhatsAppMessage(
			to,
			"No products are currently available.",
			env
		);

		return;
	}

	const rows = products.map((product) => ({
		id: `ADD_PRODUCT_${product.id}`,
		title: product.name.slice(0, 24),
		description:
			`₹${product.price} | Stock: ${product.stock}`.slice(
				0,
				72
			),
	}));

	await sendWhatsAppPayload(
		{
			messaging_product: "whatsapp",
			recipient_type: "individual",
			to,
			type: "interactive",
			interactive: {
				type: "list",
				header: {
					type: "text",
					text: "Innova Solutions",
				},
				body: {
					text:
						"Select a product to add it to your cart.",
				},
				footer: {
					text:
						"You can add multiple products one by one.",
				},
				action: {
					button: "View Products",
					sections: [
						{
							title: "Available Products",
							rows,
						},
					],
				},
			},
		},
		env
	);

	console.log(
		"Interactive product list sent"
	);
}

/*
|--------------------------------------------------------------------------
| Cart helpers
|--------------------------------------------------------------------------
*/

async function getActiveCart(
	customerPhone: string,
	env: Env
): Promise<Cart | null> {
	const supabase = getAdminClient(env);

	const { data, error } = await supabase
		.from("carts")
		.select(
			"id, customer_phone, status, created_at, updated_at"
		)
		.eq("customer_phone", customerPhone)
		.eq("status", "active")
		.maybeSingle();

	if (error) {
		console.error(
			"Active cart lookup failed:",
			error
		);

		throw new Error(
			"Could not look up active cart"
		);
	}

	if (!data) {
		return null;
	}

	return data as unknown as Cart;
}

async function getOrCreateActiveCart(
	customerPhone: string,
	env: Env
): Promise<Cart> {
	const existingCart =
		await getActiveCart(
			customerPhone,
			env
		);

	if (existingCart) {
		return existingCart;
	}

	const supabase = getAdminClient(env);

	const { data, error } = await supabase
		.from("carts")
		.insert({
			customer_phone: customerPhone,
			status: "active",
		})
		.select(
			"id, customer_phone, status, created_at, updated_at"
		)
		.single();

	if (error || !data) {
		console.error(
			"Cart creation failed:",
			error
		);

		/*
		 * A second request may have created the cart
		 * between the lookup and insert.
		 */
		const retryCart =
			await getActiveCart(
				customerPhone,
				env
			);

		if (retryCart) {
			return retryCart;
		}

		throw new Error(
			"Could not create shopping cart"
		);
	}

	return data as unknown as Cart;
}

/*
|--------------------------------------------------------------------------
| Cart action buttons
|--------------------------------------------------------------------------
*/

async function sendCartActions(
	to: string,
	productName: string,
	env: Env
): Promise<void> {
	await sendWhatsAppPayload(
		{
			messaging_product: "whatsapp",
			recipient_type: "individual",
			to,
			type: "interactive",
			interactive: {
				type: "button",
				body: {
					text: [
						`✅ ${productName} was added to your cart.`,
						"",
						"What would you like to do next?",
					].join("\n"),
				},
				footer: {
					text: "Innova Solutions",
				},
				action: {
					buttons: [
						{
							type: "reply",
							reply: {
								id: "ADD_MORE_PRODUCTS",
								title: "Add More",
							},
						},
						{
							type: "reply",
							reply: {
								id: "VIEW_CART",
								title: "View Cart",
							},
						},
						{
							type: "reply",
							reply: {
								id: "CHECKOUT_CART",
								title: "Checkout",
							},
						},
					],
				},
			},
		},
		env
	);
}

/*
|--------------------------------------------------------------------------
| Add product to cart
|--------------------------------------------------------------------------
*/

async function addProductToCart(
	sender: string,
	productId: number,
	env: Env
): Promise<void> {
	if (
		!Number.isInteger(productId) ||
		productId <= 0
	) {
		await sendWhatsAppMessage(
			sender,
			"That product selection is invalid.",
			env
		);

		return;
	}

	const supabase = getAdminClient(env);

	const {
		data: productData,
		error: productError,
	} = await supabase
		.from("products")
		.select(
			"id, name, price, description, stock"
		)
		.eq("id", productId)
		.maybeSingle();

	if (productError) {
		console.error(
			"Cart product lookup failed:",
			productError
		);

		throw new Error(
			"Could not look up selected product"
		);
	}

	if (!productData) {
		await sendWhatsAppMessage(
			sender,
			"That product could not be found.",
			env
		);

		return;
	}

	const product =
		productData as unknown as Product;

	if (product.stock <= 0) {
		await sendWhatsAppMessage(
			sender,
			`${product.name} is currently out of stock.`,
			env
		);

		return;
	}

	const cart =
		await getOrCreateActiveCart(
			sender,
			env
		);

	const {
		data: existingItemData,
		error: existingItemError,
	} = await supabase
		.from("cart_items")
		.select("id, quantity")
		.eq("cart_id", cart.id)
		.eq("product_id", product.id)
		.maybeSingle();

	if (existingItemError) {
		console.error(
			"Cart-item lookup failed:",
			existingItemError
		);

		throw new Error(
			"Could not check cart item"
		);
	}

	if (existingItemData) {
		const existingItem =
			existingItemData as unknown as ExistingCartItem;

		const newQuantity =
			existingItem.quantity + 1;

		if (newQuantity > product.stock) {
			await sendWhatsAppMessage(
				sender,
				[
					`Only ${product.stock} unit(s) of ${product.name} are available.`,
					"",
					"Please continue with the quantity already in your cart.",
				].join("\n"),
				env
			);

			return;
		}

		const { error: updateError } =
			await supabase
				.from("cart_items")
				.update({
					quantity: newQuantity,
				})
				.eq("id", existingItem.id);

		if (updateError) {
			console.error(
				"Cart quantity update failed:",
				updateError
			);

			throw new Error(
				"Could not update cart quantity"
			);
		}
	} else {
		const { error: insertError } =
			await supabase
				.from("cart_items")
				.insert({
					cart_id: cart.id,
					product_id: product.id,
					product_name: product.name,
					unit_price: product.price,
					quantity: 1,
				});

		if (insertError) {
			console.error(
				"Cart-item insert failed:",
				insertError
			);

			throw new Error(
				"Could not add product to cart"
			);
		}
	}

	await supabase
		.from("carts")
		.update({
			updated_at:
				new Date().toISOString(),
		})
		.eq("id", cart.id);

	await sendCartActions(
		sender,
		product.name,
		env
	);
}

/*
|--------------------------------------------------------------------------
| Load cart items
|--------------------------------------------------------------------------
*/

async function getCartItems(
	cartId: number,
	env: Env
): Promise<CartItem[]> {
	const supabase = getAdminClient(env);

	const { data, error } = await supabase
		.from("cart_items")
		.select(
			"id, cart_id, product_id, product_name, unit_price, quantity"
		)
		.eq("cart_id", cartId)
		.order("id", {
			ascending: true,
		});

	if (error) {
		console.error(
			"Cart-items query failed:",
			error
		);

		throw new Error(
			"Could not load cart items"
		);
	}

	return (data ?? []) as unknown as CartItem[];
}

/*
|--------------------------------------------------------------------------
| Calculate and format cart
|--------------------------------------------------------------------------
*/

function calculateCartTotal(
	items: CartItem[]
): number {
	return items.reduce(
		(total, item) =>
			total +
			item.unit_price * item.quantity,
		0
	);
}

function calculateTotalQuantity(
	items: CartItem[]
): number {
	return items.reduce(
		(total, item) =>
			total + item.quantity,
		0
	);
}

function createCartDescription(
	items: CartItem[]
): string {
	const names = items
		.map((item) => item.product_name)
		.join(", ");

	return names.slice(0, 200);
}

async function sendCartSummary(
	sender: string,
	env: Env
): Promise<void> {
	const cart =
		await getActiveCart(
			sender,
			env
		);

	if (!cart) {
		await sendWhatsAppMessage(
			sender,
			[
				"🛒 Your cart is empty.",
				"",
				"Select View Products to add an item.",
			].join("\n"),
			env
		);

		return;
	}

	const items =
		await getCartItems(
			cart.id,
			env
		);

	if (items.length === 0) {
		await sendWhatsAppMessage(
			sender,
			[
				"🛒 Your cart is empty.",
				"",
				"Select View Products to add an item.",
			].join("\n"),
			env
		);

		return;
	}

	const lines: string[] = [];

	for (const item of items) {
		const lineTotal =
			item.unit_price * item.quantity;

		lines.push(
			`${item.product_name}`,
			`${item.quantity} × ₹${item.unit_price} = ₹${lineTotal}`,
			""
		);
	}

	const total =
		calculateCartTotal(items);

	await sendWhatsAppMessage(
		sender,
		[
			"🛒 Your Cart",
			"",
			...lines,
			`Total: ₹${total}`,
		].join("\n"),
		env
	);

	await sendWhatsAppPayload(
		{
			messaging_product: "whatsapp",
			recipient_type: "individual",
			to: sender,
			type: "interactive",
			interactive: {
				type: "button",
				body: {
					text:
						"What would you like to do?",
				},
				action: {
					buttons: [
						{
							type: "reply",
							reply: {
								id: "ADD_MORE_PRODUCTS",
								title: "Add More",
							},
						},
						{
							type: "reply",
							reply: {
								id: "CHECKOUT_CART",
								title: "Checkout",
							},
						},
						{
							type: "reply",
							reply: {
								id: "CLEAR_CART",
								title: "Clear Cart",
							},
						},
					],
				},
			},
		},
		env
	);
}

/*
|--------------------------------------------------------------------------
| Clear active cart
|--------------------------------------------------------------------------
*/

async function clearCart(
	sender: string,
	env: Env
): Promise<void> {
	const cart =
		await getActiveCart(
			sender,
			env
		);

	if (!cart) {
		await sendWhatsAppMessage(
			sender,
			"Your cart is already empty.",
			env
		);

		return;
	}

	const supabase = getAdminClient(env);

	const { error } = await supabase
		.from("cart_items")
		.delete()
		.eq("cart_id", cart.id);

	if (error) {
		console.error(
			"Clear-cart operation failed:",
			error
		);

		throw new Error(
			"Could not clear shopping cart"
		);
	}

	await sendWhatsAppMessage(
		sender,
		[
			"🗑️ Your cart has been cleared.",
			"",
			"Select View Products to start again.",
		].join("\n"),
		env
	);
}

/*
|--------------------------------------------------------------------------
| Order status
|--------------------------------------------------------------------------
*/

function getOrderStatusLabel(
	status: string
): string {
	const labels: Record<string, string> = {
		pending: "Order created",
		payment_pending: "Awaiting payment",
		paid: "Payment received",
		failed: "Payment setup failed",
		cancelled: "Cancelled",
		fulfilled: "Completed",
	};

	return labels[status] ?? status;
}

function createOrderStatusMessage(
	order: Order
): string {
	const messageLines = [
		"📦 Order Status",
		"",
		`Order: #${order.id}`,
		`Product: ${order.product_name}`,
		`Quantity: ${order.quantity}`,
		`Amount: ₹${order.total_amount}`,
		`Status: ${getOrderStatusLabel(order.status)}`,
	];

	if (
		order.status === "payment_pending" &&
		order.razorpay_payment_link_url
	) {
		messageLines.push(
			"",
			"Complete your payment:",
			order.razorpay_payment_link_url
		);
	}

	if (order.status === "paid") {
		messageLines.push(
			"",
			"✅ Your payment has been received."
		);
	}

	return messageLines.join("\n");
}

/*
|--------------------------------------------------------------------------
| Track latest order
|--------------------------------------------------------------------------
*/

async function processLatestOrder(
	sender: string,
	env: Env
): Promise<void> {
	const supabase = getAdminClient(env);

	const { data, error } = await supabase
		.from("orders")
		.select(
			"id, customer_phone, product_id, product_name, quantity, unit_price, total_amount, status, razorpay_payment_link_id, razorpay_payment_link_url, razorpay_payment_id, created_at, updated_at, paid_at"
		)
		.eq("customer_phone", sender)
		.order("created_at", {
			ascending: false,
		})
		.limit(1)
		.maybeSingle();

	if (error) {
		console.error(
			"Latest-order lookup failed:",
			error
		);

		throw new Error(
			"Could not look up latest order"
		);
	}

	if (!data) {
		await sendWhatsAppMessage(
			sender,
			[
				"No orders were found for this WhatsApp number.",
				"",
				"Select View Products to place your first order.",
			].join("\n"),
			env
		);

		return;
	}

	const order =
		data as unknown as Order;

	await sendWhatsAppMessage(
		sender,
		createOrderStatusMessage(order),
		env
	);
}

/*
|--------------------------------------------------------------------------
| Track a specific order
|--------------------------------------------------------------------------
*/

async function processTrackOrderById(
	sender: string,
	orderId: number,
	env: Env
): Promise<void> {
	if (
		!Number.isInteger(orderId) ||
		orderId <= 0
	) {
		await sendWhatsAppMessage(
			sender,
			[
				"That order number is invalid.",
				"",
				"Example: track 5",
			].join("\n"),
			env
		);

		return;
	}

	const supabase = getAdminClient(env);

	const { data, error } = await supabase
		.from("orders")
		.select(
			"id, customer_phone, product_id, product_name, quantity, unit_price, total_amount, status, razorpay_payment_link_id, razorpay_payment_link_url, razorpay_payment_id, created_at, updated_at, paid_at"
		)
		.eq("id", orderId)
		.eq("customer_phone", sender)
		.maybeSingle();

	if (error) {
		console.error(
			"Order-ID lookup failed:",
			error
		);

		throw new Error(
			"Could not look up order"
		);
	}

	if (!data) {
		await sendWhatsAppMessage(
			sender,
			[
				`Order #${orderId} was not found for this WhatsApp number.`,
				"",
				"Tap Track Order to view your latest order.",
			].join("\n"),
			env
		);

		return;
	}

	const order =
		data as unknown as Order;

	await sendWhatsAppMessage(
		sender,
		createOrderStatusMessage(order),
		env
	);
}

/*
|--------------------------------------------------------------------------
| Razorpay Payment Link
|--------------------------------------------------------------------------
*/

async function createRazorpayPaymentLink(
	order: Order,
	env: Env
): Promise<RazorpayPaymentLink> {
	const authorization = btoa(
		`${env.RAZORPAY_KEY_ID}:${env.RAZORPAY_KEY_SECRET}`
	);

	const amountInPaise =
		order.total_amount * 100;

	const response = await fetch(
		"https://api.razorpay.com/v1/payment_links",
		{
			method: "POST",
			headers: {
				Authorization:
					`Basic ${authorization}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({
				amount: amountInPaise,
				currency: "INR",
				accept_partial: false,
				reference_id:
					`ORDER_${order.id}_${Date.now()}`,
				description:
					`Payment for ${order.product_name}`.slice(
						0,
						255
					),
				customer: {
					contact:
						`+${order.customer_phone}`,
				},
				notify: {
					sms: false,
					email: false,
				},
				reminder_enable: false,
				notes: {
					order_id:
						String(order.id),
					customer_phone:
						order.customer_phone,
				},
			}),
		}
	);

	const responseText =
		await response.text();

	if (!response.ok) {
		console.error(
			"Razorpay Payment Link error:",
			response.status,
			responseText
		);

		throw new Error(
			"Could not create Razorpay Payment Link"
		);
	}

	const paymentLink =
		JSON.parse(responseText);

	return {
		id: String(paymentLink.id),
		short_url:
			String(paymentLink.short_url),
	};
}

/*
|--------------------------------------------------------------------------
| Validate cart before checkout
|--------------------------------------------------------------------------
*/

async function validateCartItems(
	items: CartItem[],
	env: Env
): Promise<{
	validatedItems: CartItem[];
	totalAmount: number;
}> {
	const supabase = getAdminClient(env);
	const validatedItems: CartItem[] = [];

	for (const item of items) {
		const {
			data: productData,
			error: productError,
		} = await supabase
			.from("products")
			.select("id, name, price, stock")
			.eq("id", item.product_id)
			.maybeSingle();

		if (productError || !productData) {
			throw new Error(
				`${item.product_name} is no longer available`
			);
		}

		const product =
			productData as unknown as Product;

		if (product.stock < item.quantity) {
			throw new Error(
				`Only ${product.stock} unit(s) of ${product.name} are available`
			);
		}

		validatedItems.push({
			...item,
			product_name: product.name,
			unit_price: product.price,
		});
	}

	return {
		validatedItems,
		totalAmount:
			calculateCartTotal(
				validatedItems
			),
	};
}

/*
|--------------------------------------------------------------------------
| Checkout cart
|--------------------------------------------------------------------------
*/

async function checkoutCart(
	sender: string,
	messageId: string,
	env: Env
): Promise<void> {
	const supabase = getAdminClient(env);

	const { data: existingOrderData } =
		await supabase
			.from("orders")
			.select(
				"id, razorpay_payment_link_url"
			)
			.eq("meta_message_id", messageId)
			.maybeSingle();

	if (existingOrderData) {
		const existingOrder =
			existingOrderData as unknown as ExistingOrder;

		const lines = [
			"This checkout has already been processed.",
			"",
			`Order: #${existingOrder.id}`,
		];

		if (
			existingOrder
				.razorpay_payment_link_url
		) {
			lines.push(
				"",
				"Payment link:",
				existingOrder
					.razorpay_payment_link_url
			);
		}

		await sendWhatsAppMessage(
			sender,
			lines.join("\n"),
			env
		);

		return;
	}

	const cart =
		await getActiveCart(
			sender,
			env
		);

	if (!cart) {
		await sendWhatsAppMessage(
			sender,
			[
				"Your cart is empty.",
				"",
				"Select View Products to add products.",
			].join("\n"),
			env
		);

		return;
	}

	const cartItems =
		await getCartItems(
			cart.id,
			env
		);

	if (cartItems.length === 0) {
		await sendWhatsAppMessage(
			sender,
			"Your cart is empty.",
			env
		);

		return;
	}

	let validatedItems: CartItem[];
	let totalAmount: number;

	try {
		const validation =
			await validateCartItems(
				cartItems,
				env
			);

		validatedItems =
			validation.validatedItems;

		totalAmount =
			validation.totalAmount;
	} catch (error) {
		const message =
			error instanceof Error
				? error.message
				: "A cart item is unavailable";

		await sendWhatsAppMessage(
			sender,
			[
				"Your cart could not be checked out.",
				"",
				message,
				"",
				"Please update your cart and try again.",
			].join("\n"),
			env
		);

		return;
	}

	const firstItem =
		validatedItems[0];

	const totalQuantity =
		calculateTotalQuantity(
			validatedItems
		);

	const productDescription =
		createCartDescription(
			validatedItems
		);

	const orderProductName =
		validatedItems.length === 1
			? firstItem.product_name
			: `Cart: ${productDescription}`;

	const {
		data: orderData,
		error: orderError,
	} = await supabase
		.from("orders")
		.insert({
			customer_phone: sender,
			meta_message_id: messageId,

			/*
			 * The existing orders table requires a product ID.
			 * The detailed multi-product data is stored in order_items.
			 */
			product_id: firstItem.product_id,
			product_name:
				orderProductName.slice(
					0,
					255
				),
			quantity: totalQuantity,
			unit_price: totalAmount,
			total_amount: totalAmount,
			status: "pending",
		})
		.select("*")
		.single();

	if (orderError || !orderData) {
		console.error(
			"Cart-order creation failed:",
			orderError
		);

		throw new Error(
			"Could not create order from cart"
		);
	}

	const order =
		orderData as unknown as Order;

	const orderItemRows =
		validatedItems.map((item) => ({
			order_id: order.id,
			product_id: item.product_id,
			product_name: item.product_name,
			unit_price: item.unit_price,
			quantity: item.quantity,
			line_total:
				item.unit_price *
				item.quantity,
		}));

	const { error: itemInsertError } =
		await supabase
			.from("order_items")
			.insert(orderItemRows);

	if (itemInsertError) {
		console.error(
			"Order-items creation failed:",
			itemInsertError
		);

		await supabase
			.from("orders")
			.update({
				status: "failed",
				updated_at:
					new Date().toISOString(),
			})
			.eq("id", order.id);

		throw new Error(
			"Could not save order items"
		);
	}

	try {
		const paymentLink =
			await createRazorpayPaymentLink(
				order,
				env
			);

		const { error: updateError } =
			await supabase
				.from("orders")
				.update({
					status:
						"payment_pending",
					razorpay_payment_link_id:
						paymentLink.id,
					razorpay_payment_link_url:
						paymentLink.short_url,
					updated_at:
						new Date().toISOString(),
				})
				.eq("id", order.id);

		if (updateError) {
			throw new Error(
				"Could not save Payment Link"
			);
		}

		const { error: cartUpdateError } =
			await supabase
				.from("carts")
				.update({
					status: "checked_out",
					updated_at:
						new Date().toISOString(),
				})
				.eq("id", cart.id);

		if (cartUpdateError) {
			console.error(
				"Cart status update failed:",
				cartUpdateError
			);
		}

		const itemLines: string[] = [];

		for (const item of validatedItems) {
			itemLines.push(
				`${item.product_name}: ${item.quantity} × ₹${item.unit_price}`
			);
		}

		await sendWhatsAppMessage(
			sender,
			[
				"🧾 Order created",
				"",
				`Order: #${order.id}`,
				"",
				...itemLines,
				"",
				`Total: ₹${totalAmount}`,
				"",
				"Complete your payment:",
				paymentLink.short_url,
				"",
				"Use Track Order to view the latest status.",
			].join("\n"),
			env
		);
	} catch (error) {
		console.error(
			"Cart Payment Link creation failed:",
			error
		);

		await supabase
			.from("orders")
			.update({
				status: "failed",
				updated_at:
					new Date().toISOString(),
			})
			.eq("id", order.id);

		await sendWhatsAppMessage(
			sender,
			[
				`Order #${order.id} was created,`,
				"but the payment link could not be generated.",
				"",
				"Please try again later.",
			].join("\n"),
			env
		);
	}
}

/*
|--------------------------------------------------------------------------
| Legacy typed buy command
|--------------------------------------------------------------------------
|
| This keeps "buy 1" working.
|
|--------------------------------------------------------------------------
*/

async function processBuyCommand(
	sender: string,
	messageId: string,
	productId: number,
	env: Env
): Promise<void> {
	await addProductToCart(
		sender,
		productId,
		env
	);

	console.log(
		"Legacy buy command added product to cart:",
		{
			sender,
			messageId,
			productId,
		}
	);
}

/*
|--------------------------------------------------------------------------
| Razorpay signature verification
|--------------------------------------------------------------------------
*/

function bytesToHex(
	bytes: ArrayBuffer
): string {
	return Array.from(
		new Uint8Array(bytes)
	)
		.map((byte) =>
			byte
				.toString(16)
				.padStart(2, "0")
		)
		.join("");
}

function safeCompare(
	expected: string,
	actual: string
): boolean {
	if (expected.length !== actual.length) {
		return false;
	}

	let difference = 0;

	for (
		let index = 0;
		index < expected.length;
		index += 1
	) {
		difference |=
			expected.charCodeAt(index) ^
			actual.charCodeAt(index);
	}

	return difference === 0;
}

async function verifyRazorpaySignature(
	rawBody: string,
	signature: string,
	secret: string
): Promise<boolean> {
	try {
		const key =
			await crypto.subtle.importKey(
				"raw",
				new TextEncoder().encode(secret),
				{
					name: "HMAC",
					hash: "SHA-256",
				},
				false,
				["sign"]
			);

		const generatedSignature =
			await crypto.subtle.sign(
				"HMAC",
				key,
				new TextEncoder().encode(
					rawBody
				)
			);

		const expectedSignature =
			bytesToHex(
				generatedSignature
			);

		return safeCompare(
			expectedSignature.toLowerCase(),
			signature.toLowerCase()
		);
	} catch (error) {
		console.error(
			"Razorpay signature error:",
			error
		);

		return false;
	}
}

/*
|--------------------------------------------------------------------------
| Razorpay webhook
|--------------------------------------------------------------------------
*/

async function processRazorpayWebhook(
	request: Request,
	env: Env
): Promise<Response> {
	const rawBody =
		await request.text();

	const signature =
		request.headers.get(
			"x-razorpay-signature"
		);

	if (!signature) {
		return new Response(
			"Missing signature",
			{ status: 401 }
		);
	}

	const signatureIsValid =
		await verifyRazorpaySignature(
			rawBody,
			signature,
			env.RAZORPAY_WEBHOOK_SECRET
		);

	if (!signatureIsValid) {
		console.error(
			"Invalid Razorpay webhook signature"
		);

		return new Response(
			"Invalid signature",
			{ status: 401 }
		);
	}

	const webhookEvent =
		JSON.parse(rawBody);

	console.log(
		"Verified Razorpay webhook:",
		webhookEvent.event
	);

	const eventId =
		request.headers.get(
			"x-razorpay-event-id"
		) ??
		`${webhookEvent.event}_${webhookEvent.created_at}`;

	const supabase = getAdminClient(env);

	const { data: existingEvent } =
		await supabase
			.from(
				"processed_webhook_events"
			)
			.select("id")
			.eq("event_id", eventId)
			.maybeSingle();

	if (existingEvent) {
		console.log(
			"Duplicate webhook ignored:",
			eventId
		);

		return new Response(
			"Already processed",
			{ status: 200 }
		);
	}

	if (
		webhookEvent.event !==
		"payment_link.paid"
	) {
		console.log(
			"Razorpay event ignored:",
			webhookEvent.event
		);

		return new Response(
			"Event ignored",
			{ status: 200 }
		);
	}

	const paymentLink =
		webhookEvent.payload
			?.payment_link?.entity;

	const payment =
		webhookEvent.payload
			?.payment?.entity;

	if (!paymentLink?.id) {
		return new Response(
			"Payment Link ID missing",
			{ status: 400 }
		);
	}

	const {
		data: orderData,
		error: orderError,
	} = await supabase
		.from("orders")
		.select("*")
		.eq(
			"razorpay_payment_link_id",
			paymentLink.id
		)
		.maybeSingle();

	if (orderError) {
		console.error(
			"Payment order lookup failed:",
			orderError
		);

		return new Response(
			"Database error",
			{ status: 500 }
		);
	}

	if (!orderData) {
		console.error(
			"No order found for Payment Link:",
			paymentLink.id
		);

		return new Response(
			"Order not found",
			{ status: 404 }
		);
	}

	const order =
		orderData as unknown as Order;

	if (order.status === "paid") {
		await supabase
			.from(
				"processed_webhook_events"
			)
			.insert({
				event_id: eventId,
				event_type:
					webhookEvent.event,
			});

		return new Response(
			"Order already paid",
			{ status: 200 }
		);
	}

	const expectedAmount =
		order.total_amount * 100;

	const amountPaid =
		Number(
			payment?.amount ??
			paymentLink.amount_paid ??
			0
		);

	if (amountPaid !== expectedAmount) {
		console.error(
			"Payment amount mismatch:",
			{
				expected: expectedAmount,
				received: amountPaid,
			}
		);

		return new Response(
			"Amount mismatch",
			{ status: 400 }
		);
	}

	const { error: updateError } =
		await supabase
			.from("orders")
			.update({
				status: "paid",
				razorpay_payment_id:
					payment?.id ?? null,
				paid_at:
					new Date().toISOString(),
				updated_at:
					new Date().toISOString(),
			})
			.eq("id", order.id)
			.neq("status", "paid");

	if (updateError) {
		console.error(
			"Order payment update failed:",
			updateError
		);

		return new Response(
			"Database error",
			{ status: 500 }
		);
	}

	const { error: eventError } =
		await supabase
			.from(
				"processed_webhook_events"
			)
			.insert({
				event_id: eventId,
				event_type:
					webhookEvent.event,
			});

	if (eventError) {
		console.error(
			"Webhook event save failed:",
			eventError
		);
	}

	const { data: orderItemsData } =
		await supabase
			.from("order_items")
			.select(
				"product_name, quantity, unit_price, line_total"
			)
			.eq("order_id", order.id)
			.order("id", {
				ascending: true,
			});

	const itemLines: string[] = [];

	if (
		orderItemsData &&
		orderItemsData.length > 0
	) {
		for (const item of orderItemsData) {
			itemLines.push(
				`${item.product_name}: ${item.quantity} × ₹${item.unit_price}`
			);
		}
	} else {
		itemLines.push(
			`${order.product_name}: ${order.quantity} × ₹${order.unit_price}`
		);
	}

	await sendWhatsAppMessage(
		order.customer_phone,
		[
			"✅ Payment received",
			"",
			`Order: #${order.id}`,
			"",
			...itemLines,
			"",
			`Amount: ₹${order.total_amount}`,
			"Status: Confirmed",
			"",
			"Thank you for your order!",
		].join("\n"),
		env
	);

	return new Response(
		"Payment processed",
		{ status: 200 }
	);
}

/*
|--------------------------------------------------------------------------
| Main Cloudflare Worker
|--------------------------------------------------------------------------
*/
/*
|--------------------------------------------------------------------------
| Workers AI response generator
|--------------------------------------------------------------------------
*/

async function generateAIResponse(
	customerMessage: string,
	env: Env
): Promise<string> {
	try {
		const result = await env.AI.run(
			"@cf/meta/llama-3.1-8b-instruct-fast",
			{
				messages: [
					{
						role: "system",
						content: [
							"You are the WhatsApp customer-support assistant for Innova Solutions.",
							"Be friendly, concise, and professional.",
							"Keep every response below 500 characters.",
							"Only provide general assistance about using the chatbot.",
							"Do not invent products, prices, stock, order information, delivery dates, payment status, or company policies.",
							"Never claim that an order has been paid.",
							"Never claim that a payment was successful.",
							"Never ask for passwords, OTPs, PINs, access tokens, card numbers, CVV values, or security secrets.",
							"If the customer wants to see products, ask the customer to select View Products.",
							"If the customer wants to buy something, ask the customer to select a product from the product list.",
							"If the customer wants to see their cart, ask the customer to select View Cart.",
							"If the customer wants order status, ask the customer to select Track Order.",
							"If the customer needs human help, ask the customer to select Customer Care.",
							"If verified information is not available, clearly say that you do not have verified information.",
						].join(" "),
					},
					{
						role: "user",
						content: customerMessage,
					},
				],
				max_tokens: 160,
			}
		);

		const aiResult =
			result as AITextResponse;

		if (
			typeof aiResult.response === "string" &&
			aiResult.response.trim().length > 0
		) {
			return aiResult.response
				.trim()
				.slice(0, 500);
		}

		console.error(
			"Unexpected Workers AI response:",
			JSON.stringify(result)
		);

		return [
			"Sorry, I could not answer that question.",
			"",
			"Send hi to open the main menu.",
		].join("\n");
	} catch (error) {
		console.error(
			"Workers AI request failed:",
			error
		);

		return [
			"Sorry, the AI assistant is temporarily unavailable.",
			"",
			"Send hi to open the main menu.",
		].join("\n");
	}
}
export default {
	async fetch(
		request: Request,
		env: Env,
		ctx: ExecutionContext
	): Promise<Response> {
		const url = new URL(request.url);
		/*
|--------------------------------------------------------------------------
| Temporary Workers AI test route
|--------------------------------------------------------------------------
*/

if (
	request.method === "GET" &&
	url.pathname === "/ai-test"
) {
	const question =
		url.searchParams.get(
			"question"
		) ??
		"What can the Innova Solutions WhatsApp bot help me with?";

	const answer =
		await generateAIResponse(
			question,
			env
		);

	return Response.json({
		success: true,
		question,
		answer,
	});
}

		/*
		|--------------------------------------------------------------------------
		| Meta webhook verification
		|--------------------------------------------------------------------------
		*/

		if (
			request.method === "GET" &&
			url.pathname === "/webhook"
		) {
			const mode =
				url.searchParams.get(
					"hub.mode"
				);

			const token =
				url.searchParams.get(
					"hub.verify_token"
				);

			const challenge =
				url.searchParams.get(
					"hub.challenge"
				);

			if (
				mode === "subscribe" &&
				token === VERIFY_TOKEN &&
				challenge
			) {
				return new Response(
					challenge,
					{ status: 200 }
				);
			}

			return new Response(
				"Forbidden",
				{ status: 403 }
			);
		}

		/*
		|--------------------------------------------------------------------------
		| Razorpay webhook
		|--------------------------------------------------------------------------
		*/

		if (
			request.method === "POST" &&
			url.pathname ===
				"/razorpay-webhook"
		) {
			return processRazorpayWebhook(
				request,
				env
			);
		}

		/*
		|--------------------------------------------------------------------------
		| WhatsApp webhook
		|--------------------------------------------------------------------------
		*/

		if (
			request.method === "POST" &&
			url.pathname === "/webhook"
		) {
			const body: any =
				await request.json();

			console.log(
				"Incoming WhatsApp Event:",
				JSON.stringify(
					body,
					null,
					2
				)
			);

			const message =
				body.entry?.[0]
					?.changes?.[0]
					?.value
					?.messages?.[0];

			/*
			 * Sent, delivered and read status events
			 * do not contain messages[0].
			 */
			if (!message) {
				return new Response(
					"EVENT_RECEIVED",
					{ status: 200 }
				);
			}

			const sender =
				String(message.from);

			const messageId =
				String(
					message.id ??
					crypto.randomUUID()
				);

			const incomingText =
				message.text?.body
					?.trim()
					.toLowerCase() ?? "";

			const buttonId =
				message.interactive
					?.button_reply
					?.id ?? "";

			const listRowId =
				message.interactive
					?.list_reply
					?.id ?? "";

			console.log(
				"Parsed WhatsApp input:",
				{
					sender,
					incomingText,
					buttonId,
					listRowId,
				}
			);

			ctx.waitUntil(
				(async () => {
					try {
						/*
						| Welcome menu
						*/

						if (
							incomingText === "hi" ||
							incomingText === "hello" ||
							incomingText === "start" ||
							incomingText.startsWith(
								"hi "
							) ||
							incomingText.startsWith(
								"hello"
							)
						) {
							await sendMainMenuButtons(
								sender,
								env
							);

							return;
						}

						/*
						| Product list
						*/

						if (
							incomingText === "menu" ||
							buttonId ===
								"VIEW_PRODUCTS" ||
							buttonId ===
								"ADD_MORE_PRODUCTS"
						) {
							await sendProductList(
								sender,
								env
							);

							return;
						}

						/*
						| Product selected from the list
						*/

						const selectedProductMatch =
							listRowId.match(
								/^ADD_PRODUCT_(\d+)$/
							);

						if (
							selectedProductMatch
						) {
							const productId =
								Number(
									selectedProductMatch[1]
								);

							await addProductToCart(
								sender,
								productId,
								env
							);

							return;
						}

						/*
						| View Cart
						*/

						if (
							buttonId ===
							"VIEW_CART" ||
							incomingText ===
								"cart"
						) {
							await sendCartSummary(
								sender,
								env
							);

							return;
						}

						/*
						| Clear Cart
						*/

						if (
							buttonId ===
							"CLEAR_CART"
						) {
							await clearCart(
								sender,
								env
							);

							return;
						}

						/*
						| Checkout Cart
						*/

						if (
							buttonId ===
							"CHECKOUT_CART"
						) {
							await checkoutCart(
								sender,
								messageId,
								env
							);

							return;
						}

						/*
						| Latest Order
						*/

						if (
							buttonId ===
							"TRACK_ORDER"
						) {
							await processLatestOrder(
								sender,
								env
							);

							return;
						}

						/*
						| Customer Care
						*/

							if (buttonId === "CUSTOMER_CARE") {
							await sendCustomerCareMessage(
							sender,
							env
							);

							return;
							}


						/*
						| Track a specific order
						*/

						const trackMatch =
							incomingText.match(
								/^track\s+#?(\d+)$/
							);

						if (trackMatch) {
							const orderId =
								Number(
									trackMatch[1]
								);

							await processTrackOrderById(
								sender,
								orderId,
								env
							);

							return;
						}

						/*
						| Legacy typed buy command
						*/

						const buyMatch =
							incomingText.match(
								/^buy\s+(\d+)$/
							);

						if (buyMatch) {
							const productId =
								Number(
									buyMatch[1]
								);

							await processBuyCommand(
								sender,
								messageId,
								productId,
								env
							);

							return;
						}

						/*
|--------------------------------------------------------------------------
| AI fallback for unknown text messages
|--------------------------------------------------------------------------
*/

if (incomingText) {
	console.log(
		"Sending unknown text to Workers AI:",
		{
			sender,
			incomingText,
		}
	);

	const aiReply =
		await generateAIResponse(
			incomingText,
			env
		);

	await sendWhatsAppMessage(
		sender,
		aiReply,
		env
	);

	console.log(
		"Workers AI WhatsApp reply sent"
	);

	return;
}

/*
|--------------------------------------------------------------------------
| Unsupported message type
|--------------------------------------------------------------------------
*/

await sendWhatsAppMessage(
	sender,
	[
		"I can currently understand text messages and menu selections.",
		"",
		"Send hi to open the main menu.",
	].join("\n"),
	env
);

						// await sendWhatsAppMessage(
						// 	sender,
						// 	[
						// 		"Sorry, I did not understand that message.",
						// 		"",
						// 		"Send hi to open the main menu.",
						// 		"Send menu to view products.",
						// 		"Send cart to view your cart.",
						// 		"Send track 5 to track order 5.",
						// 	].join("\n"),
						// 	env
						// );
					} catch (error) {
						console.error(
							"WhatsApp processing failed:",
							error
						);

						try {
							await sendWhatsAppMessage(
								sender,
								[
									"Sorry, something went wrong.",
									"",
									"Please try again shortly.",
								].join("\n"),
								env
							);
						} catch (
							fallbackError
						) {
							console.error(
								"Fallback message failed:",
								fallbackError
							);
						}
					}
				})()
			);

			return new Response(
				"EVENT_RECEIVED",
				{ status: 200 }
			);
		}

		return new Response(
			"WhatsApp commerce bot is running.",
			{ status: 200 }
		);
	},
} satisfies ExportedHandler<Env>;