
async function apiFetch(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    method: options.method || 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
  })

  const text = await response.text()

  if (!response.ok) {
    let message = text || `API request failed: ${response.status}`
    try {
      const body = JSON.parse(text)
      message = body.error || message
    } catch {
      // Use the raw response when the server does not return JSON.
    }
    throw new Error(message)
  }

  try {
    return JSON.parse(text)
  } catch {
    throw new Error(
      `Expected JSON from ${path}, but received: ${text.slice(0, 200)}`
    )
  }
}


export async function getCustomers() {
  const data = await apiFetch('/api/admin/customers')
  return data.customers
}

export async function createCustomer(customer) {
  const data = await apiFetch('/api/admin/customers', {
    method: 'POST',
    body: JSON.stringify(customer),
  })

  return data.customer
}

export async function getCustomerById(customerId) {
  const data = await apiFetch(`/api/admin/customers/${customerId}`)
  return data.customer ?? data
}

export async function getCustomerHistory(customerId) {
  const data = await apiFetch(`/api/admin/customers/${customerId}/history`)
  return data.history
}

export async function getCustomerOrders(customerId) {
  const data = await apiFetch(
    `/api/admin/customers/${customerId}/orders`
  )

  if (Array.isArray(data)) return data
  if (Array.isArray(data.orders)) return data.orders

  return []
}

export async function createCustomerOrder(customerId, order) {
  const data = await apiFetch(`/api/admin/customers/${customerId}/orders`, {
    method: 'POST',
    body: JSON.stringify(order),
  })

  return data
}

export async function updateCustomer(customerId, updates) {
  const data = await apiFetch(
    `/api/admin/customers/${customerId}`,
    {
      method: 'PATCH',
      body: JSON.stringify(updates),
    }
  )

  return data.customer ?? data
}
export async function getAllOrders() {
  const data = await apiFetch('/api/admin/orders')

  if (Array.isArray(data.orders)) {
    return data.orders
  }

  return []
}

export async function getCustomerAddresses(customerId) {
  const response = await apiFetch(
    `/api/admin/customers/${customerId}/addresses`
  )

  return response.addresses ?? []
}

export async function createCustomerAddress(customerId, address) {
  return apiFetch(`/api/admin/customers/${customerId}/addresses`, {
    method: 'POST',
    body: JSON.stringify(address),
  })
}

export async function replaceCustomerAddress(customerId, addressId, address) {
  return apiFetch(
    `/api/admin/customers/${customerId}/addresses/${addressId}`,
    {
      method: 'PATCH',
      body: JSON.stringify(address),
    }
  )
}

export async function setDefaultCustomerAddress(customerId, addressId) {
  return apiFetch(
    `/api/admin/customers/${customerId}/addresses/${addressId}/default`,
    {
      method: 'PATCH',
    }
  )
}

export async function getAllCarts() {
  const data = await apiFetch('/api/admin/carts');

  if (Array.isArray(data.carts)) {
    return data.carts;
  }

  return [];
}

export async function getAllProducts() {
  const data = await apiFetch('/api/admin/products')

  if (Array.isArray(data.products)) {
    return data.products
  }

  return []
}

export async function updateProduct(productId, updates) {
  const data = await apiFetch(
    `/api/admin/products/${productId}`,
    {
      method: 'PATCH',
      body: JSON.stringify(updates),
    }
  )

  return data.product ?? data
}

export async function getAllConversations() {
  const data = await apiFetch('/api/admin/conversations')

  return {
    contexts: Array.isArray(data.contexts) ? data.contexts : [],
    states: Array.isArray(data.states) ? data.states : [],
  }
}


export async function updateOrderStatusApi(orderId, status) {
  const statusMap = {
    Pending: 'pending',
    'Payment Pending': 'payment_pending',
    Paid: 'paid',
    Failed: 'failed',
    Cancelled: 'cancelled',
    Fulfilled: 'fulfilled',
    Processing: 'PACKED',
    Shipped: 'SHIPPED',
    'In Transit': 'OUT_FOR_DELIVERY',
    Delivered: 'DELIVERED',

    // Backend status values
    pending: 'pending',
    payment_pending: 'payment_pending',
    paid: 'paid',
    failed: 'failed',
    cancelled: 'cancelled',
    fulfilled: 'fulfilled',
    PACKED: 'PACKED',
    SHIPPED: 'SHIPPED',
    OUT_FOR_DELIVERY: 'OUT_FOR_DELIVERY',
    DELIVERED: 'DELIVERED',
  }

  const apiStatus = statusMap[status]

  if (!apiStatus) {
    throw new Error(`Unsupported order status: ${status}`)
  }

  return apiFetch(`/api/admin/orders/${orderId}/status`, {
    method: 'POST',
    body: JSON.stringify({ status: apiStatus }),
  })
}
