export const mockCarts = [
  {
    id: 'CART-1001',
    customer: 'Rahul Sharma',
    phone: '+91 98765 43210',
    customerId: 'CUS-1001',
    items: [
      { id: 'P-101', product: 'Smart Watch', price: 1499, quantity: 1 },
      { id: 'P-102', product: 'Wireless Earbuds', price: 899, quantity: 2 },
    ],
    status: 'active',
    createdAt: '12 Oct 2026, 10:30 AM',
    lastUpdated: '13 Oct 2026, 09:15 AM',
  },
  {
    id: 'CART-1002',
    customer: 'Priya Reddy',
    phone: '+91 98765 12345',
    customerId: 'CUS-1002',
    items: [
      { id: 'P-103', product: 'Headphones', price: 1299, quantity: 1 },
    ],
    status: 'abandoned',
    createdAt: '11 Oct 2026, 02:20 PM',
    lastUpdated: '11 Oct 2026, 04:45 PM',
  },
  {
    id: 'CART-1003',
    customer: 'Arun Kumar',
    phone: '+91 91234 56789',
    customerId: 'CUS-1003',
    items: [
      { id: 'P-104', product: 'Backpack', price: 1200, quantity: 1 },
      { id: 'P-105', product: 'Water Bottle', price: 399, quantity: 1 },
    ],
    status: 'converted',
    createdAt: '10 Oct 2026, 11:00 AM',
    lastUpdated: '10 Oct 2026, 11:45 AM',
  },
]