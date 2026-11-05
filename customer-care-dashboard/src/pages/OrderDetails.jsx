import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  getAllOrders,
  getCustomers,
  getCustomerAddresses,
} from '../api/customerApi'
const statusSteps = [
  'Order Placed',
  'Processing',
  'Shipped',
  'Out for Delivery',
  'Delivered',
]

function createTimeline(order) {
  const history = Array.isArray(order.trackingHistory)
    ? order.trackingHistory
    : []

  const statusMap = {
    pending: 'Order Placed',
    order_placed: 'Order Placed',
    payment_pending: 'Order Placed',
    paid: 'Order Placed',
    packed: 'Processing',
    processing: 'Processing',
    shipped: 'Shipped',
    out_for_delivery: 'Out for Delivery',
    delivered: 'Delivered',
  }

  const normalize = (value) =>
    String(value || '')
      .trim()
      .toLowerCase()
      .replaceAll(' ', '_')

  const currentStatus = normalize(order.status)
  const currentStep = statusMap[currentStatus] || 'Order Placed'
  const currentIndex = statusSteps.indexOf(currentStep)

  return statusSteps.map((step, index) => {
    const historyItem = history.find((item) => {
      const historyStatus = normalize(
        item.new_status || item.status
      )
      return statusMap[historyStatus] === step
    })

    let state = 'waiting'
    let number = index + 1
    let time = 'Waiting'

    if (index < currentIndex) {
      state = 'completed'
      number = '✓'
      time = historyItem?.created_at || historyItem?.date
        ? formatDate(historyItem.created_at || historyItem.date)
        : 'Completed'
    } else if (index === currentIndex) {
      state = 'current'
      number = '●'
      time = 'Current status'
    }

    return {
      title: step,
      time,
      state,
      number,
    }
  })
}


function formatAmount(order) {
  const amount =
    order.total_amount ?? order.amount ?? order.subtotal

  if (amount == null || amount === '') return '—'

  const number = Number(amount)
  return Number.isFinite(number)
    ? `₹${number.toLocaleString('en-IN')}`
    : String(amount)
}

function formatDate(value) {
  if (!value) return '—'

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return String(value)

  return date.toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  })
}

function OrderDetails() {
  const navigate = useNavigate()
  const { id } = useParams()

  const [order, setOrder] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false

    async function loadOrder() {
      try {
        setLoading(true)
        setError('')

        const [ordersData, customersData] = await Promise.all([
          getAllOrders(),
          getCustomers().catch(() => []),
        ])
        console.log('CUSTOMERS DATA:', customersData)
        const orders = Array.isArray(ordersData) ? ordersData : []
        const customers = Array.isArray(customersData)
          ? customersData
          : []
          console.table(
  customers.map((customer) => ({
    id: customer.id,
    name: customer.name,
    keys: Object.keys(customer).join(', '),
  }))
)
        const selectedOrder = orders.find(
          (item) => String(item.id) === String(id)
        )

        if (!selectedOrder) {
          throw new Error('This order could not be found in the database.')
        }
        const addresses = await getCustomerAddresses(
  selectedOrder.customer_id
)
const shippingAddress =
  addresses.find((address) => address.is_default && address.is_active) ||
  addresses.find((address) => address.is_active) ||
  null

console.log(
  'CUSTOMER ADDRESSES:',
  JSON.stringify(addresses, null, 2)
)
       console.log(
  'FULL ORDER DATA:',
  JSON.stringify(selectedOrder, null, 2)
)

        const customer = customers.find(
          (item) =>
            String(item.id) === String(selectedOrder.customer_id)
        )
        console.log(
  'MATCHED CUSTOMER:',
  JSON.stringify(customer, null, 2)
)

        if (!cancelled) {
          setOrder({
            ...selectedOrder,
            customer:
              customer?.name ||
              (selectedOrder.customer_id != null
                ? `Customer ${selectedOrder.customer_id}`
                : selectedOrder.customer_phone || 'Unknown customer'),
            phone:
              customer?.whatsapp_number ||
              selectedOrder.customer_phone ||
              '—',
            product:
              selectedOrder.product_name ||
              'Product details unavailable',
            quantity: selectedOrder.quantity ?? 1,
            amount: formatAmount(selectedOrder),
            date: formatDate(selectedOrder.created_at),
            source: selectedOrder.source || 'WhatsApp',
           payment: {
  status:
    selectedOrder.payment_provider === 'razorpay'
      ? selectedOrder.paid_at
        ? 'Paid'
        : 'Pending'
      : 'Pending',
  method: selectedOrder.payment_provider || 'Manual',
},shippingAddress: {
  recipientName: shippingAddress?.recipient_name || '',
  phone: shippingAddress?.recipient_phone || '',
  address: [
    shippingAddress?.address_line_1,
    shippingAddress?.address_line_2,
    shippingAddress?.landmark,
  ].filter(Boolean).join(', '),
  city: shippingAddress?.city || '',
  state: shippingAddress?.state || '',
  pincode: shippingAddress?.pincode || '',
  profileName: shippingAddress?.profile_name || '',
},
trackingHistory: selectedOrder.status_history || [],          })
        }
      } catch (err) {
        if (!cancelled) {
          setError(err.message || 'Unable to load order details.')
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    loadOrder()

    return () => {
      cancelled = true
    }
  }, [id])

  if (loading) {
    return (
      <div className="order-details-page">
        <p>Loading order details...</p>
      </div>
    )
  }

  if (error || !order) {
    return (
      <div className="order-details-page">
        <button
          className="back-button"
          onClick={() => navigate('/orders')}
        >
          ← Back to Orders
        </button>
        <h2>Unable to load order</h2>
        <p>{error || 'Order not found.'}</p>
      </div>
    )
  }

  return (
    <div className="order-details-page">
      <button
        className="back-button"
        onClick={() => navigate('/orders')}
      >
        ← Back to Orders
      </button>

      <div className="order-details-header">
        <div>
          <p className="order-label">ORDER</p>
          <h2>#{order.id}</h2>
          <p>
            Placed on {order.date} via{' '}
            {order.source === 'whatsapp_bot'
              ? 'WhatsApp'
              : order.source}
          </p>
        </div>

        <span
          className={`status ${String(order.status || 'unknown')
            .toLowerCase()
            .replaceAll('_', '-')
            .replace(/\s+/g, '-')}`}
        >
          {String(order.status || 'Unknown').replaceAll('_', ' ')}
        </span>
      </div>

      <div className="order-details-grid">
        <div className="details-card">
          <h3>Customer</h3>
          <div className="detail-row">
            <span>Name</span>
            <strong>{order.customer}</strong>
          </div>
          <div className="detail-row">
            <span>Phone</span>
            <strong>{order.phone}</strong>
          </div>
          <div className="detail-row">
            <span>Order ID</span>
            <strong>#{order.id}</strong>
          </div>
        </div>

        <div className="details-card">
          <h3>Product</h3>
          <div className="product-detail">
            <div className="product-placeholder">📦</div>
            <div>
              <strong>{order.product}</strong>
              <p>Quantity: {order.quantity}</p>
            </div>
            <strong>{order.amount}</strong>
          </div>
        </div>
      </div>

      <div className="details-card">
        <h3>Payment Details</h3>
        <div className="detail-row">
          <span>Payment Status</span>
          <strong>{order.payment.status}</strong>
        </div>
        <div className="detail-row">
          <span>Payment Method</span>
          <strong>{order.payment.method}</strong>
        </div>
        <div className="detail-row">
          <span>Total Amount</span>
          <strong>{order.amount}</strong>
        </div>
      </div>

      <div className="details-card">
        <h3>Shipping Address</h3>
        <div className="shipping-address">
          <p>{order.shippingAddress.address || 'Not available'}</p>
          <p>
            {[
              order.shippingAddress.city,
              order.shippingAddress.state,
            ]
              .filter(Boolean)
              .join(', ') || ' '}
          </p>
          <p>{order.shippingAddress.pincode}</p>
        </div>
      </div>

      <div className="details-card">
        <div className="tracking-heading">
          <div>
            <h3>Order Tracking</h3>
            <p>Current delivery progress</p>
          </div>
        </div>

        <div className="tracking-timeline">
          {createTimeline(order).map((step) => (
            <div
              className={`tracking-step ${step.state}`}
              key={step.title}
            >
              <div className="tracking-dot">{step.number}</div>
              <div>
                <strong>{step.title}</strong>
                <p>{step.time}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

export default OrderDetails
