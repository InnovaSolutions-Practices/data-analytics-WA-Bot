
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { getCustomers, getAllOrders } from '../api/customerApi'

function Dashboard() {
  const navigate = useNavigate()

  const [customers, setCustomers] = useState([])
  const [orders, setOrders] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  
useEffect(() => {
  let cancelled = false

  async function loadDashboard() {
    try {
      setLoading(true)
      setError('')

      const [customerData, orderData] = await Promise.all([
        getCustomers(),
        getAllOrders(),
      ])

      if (cancelled) return

      setCustomers(
        Array.isArray(customerData) ? customerData : []
      )
      const customerMap = new Map(
  (Array.isArray(customerData) ? customerData : []).map(
    (customer) => [String(customer.id), customer]
  )
)

      const mappedOrders = (Array.isArray(orderData) ? orderData : []).map(
        (order) => ({
          ...order,
          id: String(order.id),
          
customer:
  customerMap.get(String(order.customer_id))?.name ||
  order.customer_name ||
  order.customer?.name ||
  order.customer_phone ||
  (order.customer_id != null
    ? `Customer ${order.customer_id}`
    : 'Unknown customer'),

          product:
            order.product_name || 'Product details unavailable',
          amount:
            order.total_amount ?? order.amount ?? order.subtotal ?? '—',
          status: String(order.status || 'unknown')
            .trim()
            .toLowerCase()
            .replaceAll(' ', '_'),
        })
      )

      setOrders(mappedOrders)
    } catch (err) {
      console.error('Failed to load dashboard:', err)

      if (!cancelled) {
        setError(err.message || 'Failed to load dashboard data')
      }
    } finally {
      if (!cancelled) {
        setLoading(false)
      }
    }
  }

  loadDashboard()

  return () => {
    cancelled = true
  }
}, [])

  const totalCustomers = customers.length
  const totalOrders = orders.length

  const pendingOrders = orders.filter(
    (order) => order.status?.toLowerCase() === 'pending'
  ).length

  const deliveredOrders = orders.filter(
    (order) => order.status?.toLowerCase() === 'delivered'
  ).length

  const recentOrders = [...orders].slice(-5).reverse()

  return (
    <>
      <div className="page-heading">
        <div>
          <h2>Overview</h2>
          <p>Monitor customers, orders and support activity.</p>
        </div>
      </div>

      {error && (
        <div role="alert">
          Unable to load customer data: {error}
        </div>
      )}

      <div className="stats">
        <div className="stat-card">
          <div className="stat-top">
            <span className="stat-title">Total Customers</span>
            <span className="stat-icon">👥</span>
          </div>
          <h3>{loading ? '...' : totalCustomers}</h3>
          <p>Live customer data</p>
        </div>

        <div className="stat-card">
          <div className="stat-top">
            <span className="stat-title">Total Orders</span>
            <span className="stat-icon">📦</span>
          </div>
          <h3>{loading ? '...' : totalOrders}</h3>
          <p>Live order data</p>
        </div>

        <div className="stat-card">
          <div className="stat-top">
            <span className="stat-title">Pending Orders</span>
            <span className="stat-icon">⏳</span>
          </div>
          <h3>{loading ? '...' : pendingOrders}</h3>
          <p className="warning-text">Needs attention</p>
        </div>

        <div className="stat-card">
          <div className="stat-top">
            <span className="stat-title">Delivered</span>
            <span className="stat-icon">✓</span>
          </div>
          <h3>{loading ? '...' : deliveredOrders}</h3>
          <p>Based on live order status</p>
        </div>
      </div>

      <div className="orders-section">
        <div className="section-header">
          <div>
            <h2>Recent Orders</h2>
            <p>Latest customer orders and their current status.</p>
          </div>

          <button
            className="view-all"
            onClick={() => navigate('/orders')}
          >
            View all orders →
          </button>
        </div>

        <div className="table-container">
          <table>
            <thead>
              <tr>
                <th>ORDER ID</th>
                <th>CUSTOMER</th>
                <th>PRODUCT</th>
                <th>AMOUNT</th>
                <th>STATUS</th>
              </tr>
            </thead>

            <tbody>
              {loading ? (
                <tr>
                  <td colSpan="5">Loading dashboard...</td>
                </tr>
              ) : recentOrders.length > 0 ? (
                recentOrders.map((order, index) => (
                  <tr key={order.id ?? index}>
                    <td className="order-id">{order.id}</td>
                    <td>{order.customer || '—'}</td>
                    <td>{order.product || '—'}</td>
                    <td>{order.amount ?? '—'}</td>
                    <td>
                      <span
                        className={`status ${String(order.status || '')
                          .toLowerCase()
                          .replace(/\s+/g, '-')}`}
                      >
                        {order.status || 'Unknown'}
                      </span>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan="5">No orders found.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  )
}

export default Dashboard
