
import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { getAllCarts } from '../api/customerApi'

function formatPhone(phone) {
  const digits = String(phone ?? '').replace(/\D/g, '')

  if (!digits) return '—'

  const localNumber =
    digits.startsWith('91') && digits.length === 12
      ? digits.slice(2)
      : digits

  return `+91 ${localNumber}`
}

function CartDetails() {
  const navigate = useNavigate()
  const { id } = useParams()

  const [cart, setCart] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false

    async function loadCart() {
      try {
        setLoading(true)
        setError('')

        const carts = await getAllCarts()
        const found = carts.find(
          (item) => String(item.id) === String(id)
        )

        if (!cancelled) setCart(found ?? null)
      } catch (err) {
        if (!cancelled) {
          setError(err.message || 'Could not load cart details.')
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    loadCart()

    return () => {
      cancelled = true
    }
  }, [id])

  const items = cart?.items ?? []

  const totalQuantity = items.reduce(
    (sum, item) => sum + Number(item.quantity ?? 0),
    0
  )

  const total = items.reduce(
    (sum, item) =>
      sum +
      Number(item.unit_price ?? 0) * Number(item.quantity ?? 0),
    0
  )

  const formatPrice = (amount) =>
    Number(amount || 0).toLocaleString('en-IN', {
      style: 'currency',
      currency: 'INR',
      maximumFractionDigits: 2,
    })

  const formatDate = (value) => {
    if (!value) return '—'

    return new Date(value).toLocaleString('en-IN', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  }

  const formatStatus = (status) =>
    String(status || 'Unknown')
      .replaceAll('_', ' ')
      .replace(/\b\w/g, (char) => char.toUpperCase())

  if (loading) {
    return (
      <div className="order-details-page">
        <button className="back-button" onClick={() => navigate('/carts')}>
          ← Back to Carts
        </button>
        <p>Loading cart details...</p>
      </div>
    )
  }

  if (error || !cart) {
    return (
      <div className="order-details-page">
        <button className="back-button" onClick={() => navigate('/carts')}>
          ← Back to Carts
        </button>
        <h2>{error ? 'Unable to load cart' : 'Cart not found'}</h2>
        {error && <p>{error}</p>}
      </div>
    )
  }

  return (
    <div className="order-details-page">
      <button className="back-button" onClick={() => navigate('/carts')}>
        ← Back to Carts
      </button>

      <div className="order-details-header">
        <div>
          <p className="order-label">CART DETAILS</p>
          <h2>CART-{cart.id}</h2>
          <p>Customer shopping cart information</p>
        </div>

        <span className={`status ${String(cart.status || 'unknown').toLowerCase()}`}>
          {formatStatus(cart.status)}
        </span>
      </div>

      <div className="order-details-grid">
        <div className="details-card">
          <h3>Customer Details</h3>
          <div className="detail-row">
            <span>Phone Number</span>
            <strong>{formatPhone(cart.customer_phone)}</strong>
          </div>
          <div className="detail-row">
            <span>Customer ID</span>
            <strong>{cart.customer_id ?? 'Not linked'}</strong>
          </div>
        </div>

        <div className="details-card">
          <h3>Cart Summary</h3>
          <div className="detail-row">
            <span>Unique Products</span>
            <strong>{items.length}</strong>
          </div>
          <div className="detail-row">
            <span>Total Quantity</span>
            <strong>{totalQuantity}</strong>
          </div>
          <div className="detail-row">
            <span>Cart Value</span>
            <strong>{formatPrice(total)}</strong>
          </div>
        </div>
      </div>

      <div className="details-card">
        <div className="tracking-heading">
          <div>
            <h3>Cart Items</h3>
            <p>Products recorded in this cart</p>
          </div>
        </div>

        <div className="table-container">
          <table>
            <thead>
              <tr>
                <th>PRODUCT</th>
                <th>UNIT PRICE</th>
                <th>QUANTITY</th>
                <th>SUBTOTAL</th>
              </tr>
            </thead>

            <tbody>
              {items.length > 0 ? (
                items.map((item) => (
                  <tr key={item.id}>
                    <td>{item.product_name || `Product #${item.product_id}`}</td>
                    <td>{formatPrice(item.unit_price)}</td>
                    <td>{item.quantity}</td>
                    <td>
                      {formatPrice(
                        Number(item.unit_price ?? 0) *
                        Number(item.quantity ?? 0)
                      )}
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan="4" style={{ textAlign: 'center', padding: '30px' }}>
                    No items recorded for this cart.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="details-card">
        <h3>Cart Activity</h3>
        <div className="detail-row">
          <span>Created On</span>
          <strong>{formatDate(cart.created_at)}</strong>
        </div>
        <div className="detail-row">
          <span>Last Updated</span>
          <strong>{formatDate(cart.updated_at)}</strong>
        </div>
        <div className="detail-row">
          <span>Cart Status</span>
          <strong>{formatStatus(cart.status)}</strong>
        </div>
      </div>

      <div className="details-card">
        <div className="detail-row">
          <h3>Cart Total</h3>
          <h2>{formatPrice(total)}</h2>
        </div>
        <p style={{ color: '#6b7280', fontSize: '13px' }}>
          Total calculated from the products and quantities recorded in this cart.
        </p>
      </div>
    </div>
  )
}

export default CartDetails
