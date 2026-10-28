
import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { getAllOrders, getCustomers } from '../api/customerApi'

const statusSteps = [
  'Order Placed',
  'Processing',
  'Shipped',
  'In Transit',
  'Delivered',
]

function createTimeline(order) {
  const history = order.trackingHistory || []

  return statusSteps.map((step, index) => {
    const historyItem = history.find(
      (item) =>
        String(item.status || '').toLowerCase() === step.toLowerCase()
    )

    return historyItem
      ? {
          title: step,
          time: historyItem.date || '—',
          state: 'completed',
          number: '✓',
        }
      : {
          title: step,
          time: 'Waiting',
          state: '',
          number: index + 1,
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

        const orders = Array.isArray(ordersData) ? ordersData : []
        const customers = Array.isArray(customersData)
          ? customersData
          : []

        const selectedOrder = orders.find(
          (item) => String(item.id) === String(id)
        )

        if (!selectedOrder) {
          throw new Error('This order could not be found in the database.')
        }

        const customer = customers.find(
          (item) =>
            String(item.id) === String(selectedOrder.customer_id)
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
            trackingId: selectedOrder.tracking_id || null,
            payment: {
  status: selectedOrder.status
    ? selectedOrder.status.replaceAll('_', ' ')
    : 'Not available',
  method: selectedOrder.payment_provider || 'Not available',
},
            shippingAddress: {
              address: selectedOrder.shipping_address || '',
              city: selectedOrder.shipping_city || '',
              state: selectedOrder.shipping_state || '',
              pincode: selectedOrder.shipping_pincode || '',
            },
            trackingHistory: selectedOrder.trackingHistory || [],
          })
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
          <span className="tracking-id">
            Tracking ID: {order.trackingId || 'Not assigned'}
          </span>
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
