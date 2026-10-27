import { useEffect, useState } from 'react'
import {
  getAllOrders,
  updateOrderStatusApi,
} from '../api/customerApi'



const statusOptions = [
  'Pending',
  'Processing',
  'Shipped',
  'In Transit',
  'Delivered',
]

const trackingInfo = {
  '1001': {
    trackingId: 'TRK-784512',
    phone: '+91 98765 43210',
  },
  '1002': {
    trackingId: 'TRK-784513',
    phone: '+91 98765 12345',
  },
  '1003': {
    trackingId: 'TRK-784514',
    phone: '+91 91234 56789',
  },
  '1004': {
    trackingId: 'TRK-784515',
    phone: '+91 99887 66554',
  },
  '1005': {
    trackingId: 'TRK-784516',
    phone: '+91 90000 11111',
  },
}

function createTimeline(order) {
  const statuses = [
    'Order Placed',
    'Processing',
    'Shipped',
    'In Transit',
    'Delivered',
  ]

  const history = order.trackingHistory || []

  return statuses.map((status) => {
    const historyItem = history.find(
      (item) => item.status === status
    )

    return {
      status,
      date: historyItem?.date || '--',
      completed: Boolean(historyItem),
      active: order.status === status,
    }
  })
}
const allowedTransitions = {
  pending: ['payment_pending', 'paid', 'failed', 'cancelled'],
  payment_pending: ['paid', 'failed', 'cancelled'],
  paid: ['PACKED', 'fulfilled', 'cancelled'],
  failed: ['payment_pending', 'cancelled'],
  cancelled: [],
  fulfilled: [],
  PACKED: ['SHIPPED', 'cancelled'],
  SHIPPED: ['OUT_FOR_DELIVERY', 'cancelled'],
  OUT_FOR_DELIVERY: ['DELIVERED', 'cancelled'],
  DELIVERED: [],
}

const statusLabels = {
  pending: 'Pending',
  payment_pending: 'Payment Pending',
  paid: 'Paid',
  failed: 'Failed',
  cancelled: 'Cancelled',
  fulfilled: 'Fulfilled',
  PACKED: 'Processing',
  SHIPPED: 'Shipped',
  OUT_FOR_DELIVERY: 'In Transit',
  DELIVERED: 'Delivered',
}
function Tracking() {
  const [orders, setOrders] = useState([])
  const [search, setSearch] = useState('')
  const [selectedOrder, setSelectedOrder] = useState(null)
  const [status, setStatus] = useState('')

  useEffect(() => {
  async function loadOrders() {
    try {
      const data = await getAllOrders()

      const formattedOrders = data.map((order) => ({
        ...order,
        id: String(order.id),
        customer: order.customer_name || order.customer || 'Unknown customer',
        product: order.product_name || 'Product not recorded',
        status: order.status || 'Pending',
      }))

      setOrders(formattedOrders)

      if (formattedOrders.length > 0) {
        setSelectedOrder(formattedOrders[0])
        setStatus(formattedOrders[0].status)
      }
    } catch (error) {
      console.error('Failed to load orders:', error)
    }
  }

  loadOrders()
}, [])

  const filteredOrders = orders.filter((order) => {
    const searchText = search.toLowerCase().trim()

    const trackingId =
      trackingInfo[order.id.replace('#ORD-', '')]?.trackingId || ''

    return (
      order.id.toLowerCase().includes(searchText) ||
      trackingId.toLowerCase().includes(searchText) ||
      order.customer.toLowerCase().includes(searchText)
    )
  })

  const handleSelectOrder = (order) => {
    setSelectedOrder(order)
    setStatus(order.status)
  }


const [saving, setSaving] = useState(false)
const [message, setMessage] = useState('')

const handleStatusUpdate = async () => {
  if (!selectedOrder || saving) return

  try {
    setSaving(true)
    setMessage('')

    const result = await updateOrderStatusApi(
      selectedOrder.id,
      status
    )

    const savedOrder = result.order ?? result
    const savedStatus = savedOrder.status ?? status

    setOrders((previousOrders) =>
      previousOrders.map((order) =>
        order.id === selectedOrder.id
          ? { ...order, status: savedStatus }
          : order
      )
    )

    setSelectedOrder((previous) =>
      previous
        ? { ...previous, status: savedStatus }
        : previous
    )

    setStatus(savedStatus)
    setMessage('Order status updated successfully.')
  } catch (error) {
    setMessage(`Failed to update status: ${error.message}`)
  } finally {
    setSaving(false)
  }
}

  return (
    <div className="tracking-page">

      <div className="page-heading">
        <div>
          <h2>Tracking</h2>
          <p>Track orders and update their delivery status.</p>
        </div>
      </div>

      <div className="tracking-toolbar">
        <input
          type="text"
          placeholder="Search by order ID, tracking ID or customer..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <div className="tracking-layout">

        {/* Order List */}
        <div className="tracking-orders">

          <div className="section-header">
            <div>
              <h2>Orders</h2>
              <p>{filteredOrders.length} orders</p>
            </div>
          </div>

          <div className="tracking-order-list">

            {filteredOrders.length > 0 ? (
              filteredOrders.map((order) => (
                <button
                  key={order.id}
                  className={`tracking-order-item ${
                    selectedOrder?.id === order.id
                      ? 'selected'
                      : ''
                  }`}
                  onClick={() => handleSelectOrder(order)}
                >
                  <div>
                    <strong>{order.id}</strong>
                    <p>{order.customer}</p>
                    <span>{order.product}</span>
                  </div>

                  <span className="tracking-status">
                    {order.status}
                  </span>
                </button>
              ))
            ) : (
              <div className="tracking-empty">
                No orders found
              </div>
            )}

          </div>
        </div>

        {/* Tracking Details */}
        {selectedOrder && (
          <div className="tracking-details">

            <div className="tracking-details-header">
              <div>
                <span className="order-label">
                  ORDER
                </span>

                <h2>{selectedOrder.id}</h2>

                <p>
                  {selectedOrder.customer} ·{' '}
                  {selectedOrder.product}
                </p>
              </div>

              <span className="tracking-id">
                {
                  trackingInfo[
                    selectedOrder.id.replace('#ORD-', '')
                  ]?.trackingId
                }
              </span>
            </div>

            {/* Update Status */}
            <div className="status-update-card">
            

              <div>
                <h3>Update Order Status</h3>
                <p>
                  Change the current status of this order.
                </p>
              </div>

              <div className="status-update-controls">

                <select
  value={status}
  onChange={(e) => setStatus(e.target.value)}
>
  <option value={selectedOrder.status}>
    {statusLabels[selectedOrder.status] || selectedOrder.status}
  </option>

  {(allowedTransitions[selectedOrder.status] || []).map(
    (nextStatus) => (
      <option key={nextStatus} value={nextStatus}>
        {statusLabels[nextStatus] || nextStatus}
      </option>
    )
  )}
</select>

                <button
  className="update-status-button"
  onClick={handleStatusUpdate}
  disabled={saving}
>
  {saving ? 'Updating...' : 'Update Status'}
</button>
                {message && <p role="status">{message}</p>}

              </div>
            </div>

            {/* Timeline */}
            <div className="tracking-timeline-card">

              <div className="tracking-heading">
                <div>
                  <h3>Tracking History</h3>
                  <p>Current order progress</p>
                </div>
              </div>

              <div className="tracking-timeline">

                {createTimeline(
                  selectedOrder
                ).map((step, index) => (
                  <div
                    className={`tracking-step ${
                      step.completed ? 'completed' : ''
                    } ${
                      step.active ? 'active' : ''
                    }`}
                    key={step.status}
                  >

                    <div className="tracking-dot">
                      {step.completed ? '✓' : index + 1}
                    </div>

                    <div>
                      <strong>{step.status}</strong>
                      <p>{step.date}</p>
                    </div>

                  </div>
                ))}

              </div>

            </div>

          </div>
        )}

      </div>

    </div>
  )
}

export default Tracking