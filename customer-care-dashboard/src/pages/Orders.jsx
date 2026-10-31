import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { getAllOrders, getCustomers } from '../api/customerApi'

function formatDate(value) {
  if (!value) return '—'

  const date = new Date(value)

  if (Number.isNaN(date.getTime())) return '—'

  return date.toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  })
}

function formatAmount(order) {
  const amount =
    order.total_amount ?? order.amount ?? order.subtotal

  if (amount == null || amount === '') return '—'

  const number = Number(amount)

  if (!Number.isFinite(number)) return '—'

  return `₹${number.toLocaleString('en-IN')}`
}

function normalizeStatus(status) {
  return String(status || 'unknown')
    .trim()
    .toLowerCase()
    .replaceAll(' ', '_')
}

function Orders() {
  const navigate = useNavigate()

  const [orders, setOrders] = useState([])
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false

    async function loadOrders() {
      try {
        setLoading(true)
        setError('')

        
const ordersData = await getAllOrders()

const customersData = await getCustomers().catch((err) => {
  console.error('Failed to load customers:', err)
  return []
})

const customers = Array.isArray(customersData) ? customersData : []

const customerMap = new Map(
  customers.map((customer) => [String(customer.id), customer])
)

const mappedOrders = (Array.isArray(ordersData) ? ordersData : []).map(
  (order) => {
    const customer = customerMap.get(String(order.customer_id))

    return {
      ...order,
      id: String(order.id),
      customer:
        customer?.name ||
        (order.customer_id != null
          ? `Customer ${order.customer_id}`
          : order.customer_phone || 'Unknown customer'),
      product: order.product_name || 'Product details unavailable',
      quantity: order.quantity ?? 1,
      source: order.payment_provider === 'manual' ? 'Manual' : 'WhatsApp',
      date: formatDate(order.created_at),
      amount: formatAmount(order),
      status: normalizeStatus(order.status),
    }
  }
)

if (!cancelled) {
  setOrders(mappedOrders)
}
      } catch (err) {
        console.error('Failed to load orders:', err)

        if (!cancelled) {
          setError(
            err.message || 'Unable to load orders from the server.'
          )
        }
      } finally {
        if (!cancelled) {
          setLoading(false)
        }
      }
    }

    loadOrders()

    return () => {
      cancelled = true
    }
  }, [])

  const filteredOrders = orders.filter((order) => {
    const searchText = search.toLowerCase().trim()

    const matchesSearch = [
      order.id,
      order.customer,
      order.product,
      order.customer_phone,
    ].some((value) =>
      String(value ?? '').toLowerCase().includes(searchText)
    )

    const matchesStatus =
      statusFilter === 'all' ||
      order.status === statusFilter

    return matchesSearch && matchesStatus
  })

  return (
    <div className="orders-page">
      <div className="page-heading">
        <div>
          <h2>Orders</h2>
          <p>View and manage customer orders.</p>
        </div>
      </div>

      <div className="order-toolbar">
        <input
          type="text"
          placeholder="Search by order ID, customer or product..."
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />

        <select
          value={statusFilter}
          onChange={(event) => setStatusFilter(event.target.value)}
        >
          <option value="all">All Status</option>
          <option value="pending">Pending</option>
          <option value="payment_pending">Payment Pending</option>
          <option value="paid">Paid</option>
          <option value="confirmed">Confirmed</option>
          <option value="packed">Packed</option>
          <option value="shipped">Shipped</option>
          <option value="out_for_delivery">Out for Delivery</option>
          <option value="delivered">Delivered</option>
          <option value="cancelled">Cancelled</option>
          <option value="refunded">Refunded</option>
        </select>
      </div>

      <div className="orders-section">
        <div className="section-header">
          <div>
            <h2>All Orders</h2>
            <p>
              {loading
                ? 'Loading orders...'
                : `${filteredOrders.length} orders`}
            </p>
          </div>
        </div>

        {error && (
          <div className="error-message">
            <p>{error}</p>
            <button onClick={() => window.location.reload()}>
              Retry
            </button>
          </div>
        )}

        <div className="table-container">
          <table>
            <thead>
              <tr>
                <th>ORDER ID</th>
                <th>CUSTOMER</th>
                <th>PRODUCT</th>
                <th>ITEMS</th>
                <th>SOURCE</th>
                <th>DATE</th>
                <th>AMOUNT</th>
                <th>STATUS</th>
                <th>ACTION</th>
              </tr>
            </thead>

            <tbody>
              {loading ? (
                <tr>
                  <td colSpan="9" style={{ textAlign: 'center', padding: '30px' }}>
                    Loading orders from the server...
                  </td>
                </tr>
              ) : error ? (
                <tr>
                  <td colSpan="9" style={{ textAlign: 'center', padding: '30px' }}>
                    Orders could not be loaded.
                  </td>
                </tr>
              ) : filteredOrders.length > 0 ? (
                filteredOrders.map((order) => (
                  <tr key={order.id}>
                    <td className="order-id">#{order.id}</td>
                    <td>{order.customer}</td>
                    <td>{order.product}</td>
                    <td>{order.quantity}</td>
                    <td>{order.source}</td>
                    <td>{order.date}</td>
                    <td>{order.amount}</td>
                    <td>
                      <span
                        className={`status ${order.status.replaceAll('_', '-')}`}
                      >
                        {order.status.replaceAll('_', ' ')
                          .replace(/\b\w/g, (char) => char.toUpperCase())}
                      </span>
                    </td>
                    <td>
                      <button
                        className="view-button"
                        onClick={() => navigate(`/orders/${order.id}`)}
                      >
                        View
                      </button>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td
                    colSpan="9"
                    style={{
                      textAlign: 'center',
                      padding: '30px',
                      color: '#6b7280',
                    }}
                  >
                    No orders found
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

export default Orders
