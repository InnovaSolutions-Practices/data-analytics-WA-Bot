
import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { getAllCarts } from '../api/customerApi'

function formatDate(dateString) {
  if (!dateString) return '—'

  return new Date(dateString).toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function formatCurrency(amount) {
  return Number(amount || 0).toLocaleString('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 2,
  })
}

function formatPhone(phone) {
  const digits = String(phone ?? '').replace(/\D/g, '')

  if (!digits) return '—'

  // Remove an existing India country code to avoid duplication.
  const localNumber = digits.startsWith('91') && digits.length === 12
    ? digits.slice(2)
    : digits

  return `+91 ${localNumber}`
}


function Carts() {
  const navigate = useNavigate()
  const [carts, setCarts] = useState([])
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false

    async function loadCarts() {
      try {
        setLoading(true)
        setError('')

        const data = await getAllCarts()

        if (!cancelled) setCarts(data)
      } catch (err) {
        if (!cancelled) {
          setError(err.message || 'Could not load carts.')
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    loadCarts()

    return () => {
      cancelled = true
    }
  }, [])

  const filteredCarts = useMemo(() => {
    const query = search.trim().toLowerCase()

    return carts.filter((cart) => {
      const cartId = String(cart.id ?? '')
      const phone = String(cart.customer_phone ?? '')
      const matchesSearch =
        cartId.toLowerCase().includes(query) ||
        phone.toLowerCase().includes(query) ||
        phone.replace(/\D/g, '').includes(query.replace(/\D/g, ''))

      const matchesStatus =
        statusFilter === 'all' ||
        String(cart.status ?? '').toLowerCase() === statusFilter

      return matchesSearch && matchesStatus
    })
  }, [carts, search, statusFilter])

  const getCartTotal = (cart) =>
    (cart.items ?? []).reduce(
      (total, item) =>
        total +
        Number(item.unit_price ?? 0) * Number(item.quantity ?? 0),
      0,
    )

  const getItemCount = (cart) =>
    (cart.items ?? []).reduce(
      (total, item) => total + Number(item.quantity ?? 0),
      0,
    )
    
  const totalCarts = carts.length

  const activeCarts = carts.filter(
    (cart) => String(cart.status).toLowerCase() === 'active'
  ).length

  const abandonedCarts = carts.filter(
    (cart) => String(cart.status).toLowerCase() === 'abandoned'
  ).length

  const checkedOutCarts = carts.filter(
    (cart) => String(cart.status).toLowerCase() === 'checked_out'
  ).length


  return (
    <div className="carts-page">
      <div className="page-heading cart-page-heading">
        <div>
          <h2>Carts</h2>
          <p>View customer carts and their products.</p>
        </div>

        <span className="status active">Live Data</span>
      </div>
      
  <div className="cart-stats-grid">
    <div className="cart-stat-card">
      <p>Total Carts</p>
      <h2>{loading ? '—' : totalCarts}</h2>
    </div>

    <div className="cart-stat-card">
      <p>Active Carts</p>
      <h2>{loading ? '—' : activeCarts}</h2>
    </div>

    <div className="cart-stat-card">
      <p>Abandoned Carts</p>
      <h2>{loading ? '—' : abandonedCarts}</h2>
    </div>

    <div className="cart-stat-card">
      <p>Checked Out</p>
      <h2>{loading ? '—' : checkedOutCarts}</h2>
    </div>
  </div>

      <div className="order-toolbar">
        <input
          type="text"
          placeholder="Search by phone number or cart ID..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />

        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
        >
          <option value="all">All Status</option>
          <option value="active">Active</option>
          <option value="abandoned">Abandoned</option>
          <option value="converted">Converted</option>
          <option value="checked_out">Checked Out</option>
        </select>
      </div>

      <div className="orders-section">
        <div className="section-header">
          <div>
            <h2>All Carts</h2>
            <p>{filteredCarts.length} carts</p>
          </div>
        </div>

        <div className="table-container">
          <table>
            <thead>
              <tr>
                <th>CART ID</th>
                <th>CUSTOMER PHONE</th>
                <th>ITEMS</th>
                <th>CART VALUE</th>
                <th>STATUS</th>
                <th>LAST UPDATED</th>
                <th>ACTION</th>
              </tr>
            </thead>

            <tbody>
              {loading ? (
                <tr>
                  <td colSpan="7" style={{ textAlign: 'center', padding: '40px' }}>
                    Loading carts...
                  </td>
                </tr>
              ) : error ? (
                <tr>
                  <td colSpan="7" style={{ textAlign: 'center', padding: '40px' }}>
                    {error}
                  </td>
                </tr>
              ) : filteredCarts.length > 0 ? (
                filteredCarts.map((cart) => (
                  <tr key={cart.id}>
                    <td className="order-id">CART-{cart.id}</td>
                    <td>{formatPhone(cart.customer_phone)}</td>
                    <td>{getItemCount(cart)}</td>
                    <td>{formatCurrency(getCartTotal(cart))}</td>
                    <td>
                      <span
                        className={`status ${String(cart.status || 'unknown').toLowerCase()}`}
                      >
                        {String(cart.status || 'Unknown')
                          .replaceAll('_', ' ')
                          .replace(/\b\w/g, (char) => char.toUpperCase())}
                      </span>
                    </td>
                    <td>{formatDate(cart.updated_at)}</td>
                    <td>
                      <button
                        className="view-button"
                        onClick={() => navigate(`/carts/${cart.id}`)}
                      >
                        View
                      </button>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan="7" style={{ textAlign: 'center', padding: '40px' }}>
                    No carts match your search or filter.
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

export default Carts
