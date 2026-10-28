const STORAGE_KEY = 'customer_care_orders'

export const initialOrders = [
  {
    id: '#ORD-1001',
    customer: 'Rahul',
    phone: '+91 98765 43210',
    product: 'Smart Watch',
    quantity: 1,
    amount: '₹1,499',
    source: 'whatsapp_bot',

    shippingAddress: {
      address: '12, MG Road',
      city: 'Bengaluru',
      state: 'Karnataka',
      pincode: '560001',
    },

    payment: {
      status: 'Paid',
      method: 'UPI',
    },

    trackingId: 'TRK-784512',

    date: '02 Oct 2026',
    status: 'Shipped',

    trackingHistory: [
      { status: 'Order Placed', date: '28 Sep 2026, 10:32 AM' },
      { status: 'Processing', date: '28 Sep 2026, 11:15 AM' },
      { status: 'Shipped', date: '29 Sep 2026, 09:20 AM' },
    ],
  },

  {
    id: '#ORD-1002',
    customer: 'Priya',
    phone: '+91 98765 12345',
    product: 'Headphones',
    quantity: 1,
    amount: '₹899',
    source: 'whatsapp_bot',

    shippingAddress: {
      address: '24, Residency Road',
      city: 'Bengaluru',
      state: 'Karnataka',
      pincode: '560025',
    },

    payment: {
      status: 'Paid',
      method: 'UPI',
    },

    trackingId: 'TRK-784513',

    date: '01 Oct 2026',
    status: 'Pending',

    trackingHistory: [
      { status: 'Order Placed', date: '01 Oct 2026, 10:20 AM' },
    ],
  },

  {
    id: '#ORD-1003',
    customer: 'Arun',
    phone: '+91 91234 56789',
    product: 'Backpack',
    quantity: 1,
    amount: '₹1,200',
    source: 'whatsapp_bot',

    shippingAddress: {
      address: '18, Anna Nagar',
      city: 'Chennai',
      state: 'Tamil Nadu',
      pincode: '600040',
    },

    payment: {
      status: 'Paid',
      method: 'Card',
    },

    trackingId: 'TRK-784514',

    date: '30 Sep 2026',
    status: 'Delivered',

    trackingHistory: [
      { status: 'Order Placed', date: '28 Sep 2026, 09:30 AM' },
      { status: 'Processing', date: '28 Sep 2026, 11:00 AM' },
      { status: 'Shipped', date: '29 Sep 2026, 08:45 AM' },
      { status: 'In Transit', date: '29 Sep 2026, 02:30 PM' },
      { status: 'Delivered', date: '30 Sep 2026, 04:15 PM' },
    ],
  },

  {
    id: '#ORD-1004',
    customer: 'Sneha',
    phone: '+91 99887 66554',
    product: 'Running Shoes',
    quantity: 1,
    amount: '₹2,499',
    source: 'manual',

    shippingAddress: {
      address: '45, Koramangala',
      city: 'Bengaluru',
      state: 'Karnataka',
      pincode: '560034',
    },

    payment: {
      status: 'Paid',
      method: 'UPI',
    },

    trackingId: 'TRK-784515',

    date: '29 Sep 2026',
    status: 'Processing',

    trackingHistory: [
      { status: 'Order Placed', date: '29 Sep 2026, 09:15 AM' },
      { status: 'Processing', date: '29 Sep 2026, 10:30 AM' },
    ],
  },

  {
    id: '#ORD-1005',
    customer: 'Kiran',
    phone: '+91 90000 11111',
    product: 'Bluetooth Speaker',
    quantity: 1,
    amount: '₹1,799',
    source: 'whatsapp_bot',

    shippingAddress: {
      address: '10, Banjara Hills',
      city: 'Hyderabad',
      state: 'Telangana',
      pincode: '500034',
    },

    payment: {
      status: 'Paid',
      method: 'Cash on Delivery',
    },

    trackingId: 'TRK-784516',

    date: '28 Sep 2026',
    status: 'In Transit',

    trackingHistory: [
      { status: 'Order Placed', date: '27 Sep 2026, 10:00 AM' },
      { status: 'Processing', date: '27 Sep 2026, 11:20 AM' },
      { status: 'Shipped', date: '28 Sep 2026, 09:00 AM' },
      { status: 'In Transit', date: '28 Sep 2026, 03:30 PM' },
    ],
  },
]

export function getOrders() {
  const savedOrders = localStorage.getItem(STORAGE_KEY)

  if (savedOrders) {
    return JSON.parse(savedOrders)
  }

  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify(initialOrders)
  )

  return initialOrders
}

export function updateOrderStatus(orderId, status) {
  const orders = getOrders()

  const timestamp = new Date().toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })

  const updatedOrders = orders.map((order) => {
    if (order.id !== orderId) {
      return order
    }

    const history = order.trackingHistory || []

    // Record the status and its latest update time.
    const existingIndex = history.findIndex(
      (item) => item.status === status
    )

    const updatedHistory =
      existingIndex >= 0
        ? history.map((item, index) =>
            index === existingIndex
              ? { ...item, date: timestamp }
              : item
          )
        : [...history, { status, date: timestamp }]

    return {
      ...order,
      status,
      trackingHistory: updatedHistory,
    }
  })

  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify(updatedOrders)
  )

  window.dispatchEvent(new Event('ordersUpdated'))

  return updatedOrders
}
