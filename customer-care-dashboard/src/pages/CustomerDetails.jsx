
import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  getCustomerById,
  getCustomerOrders,
  getCustomerAddresses,
} from '../api/customerApi'
function formatPhone(phone) {
  if (!phone) return ''

  const digits = String(phone).replace(/\D/g, '')
  const number =
    digits.startsWith('91') && digits.length === 12
      ? digits.slice(2)
      : digits

  if (number.length === 10) {
    return `+91 ${number.slice(0, 5)} ${number.slice(5)}`
  }

  return `+${digits}`
}

function CustomerDetails() {
  const navigate = useNavigate()
  const { customerId } = useParams()

  const [customer, setCustomer] = useState(null)
  const [allOrders, setAllOrders] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [addresses, setAddresses] = useState([])
  

  useEffect(() => {
    let cancelled = false

    async function loadCustomer() {
      try {
        setLoading(true)
        setError('')

        const data = await getCustomerById(customerId)
        if (cancelled) return

        setCustomer({
          ...data,
          name: data.name || `Customer ${data.id}`,
          phone: formatPhone(data.whatsapp_number),
          email: data.email || '',
          address:
            data.address?.address_line ||
            data.address?.full_address ||
            data.profile?.address ||
            data.metadata?.address ||
            '',
        })
        const customerAddresses = await getCustomerAddresses(customerId)

if (cancelled) return

setAddresses(customerAddresses)

        const orders = await getCustomerOrders(customerId)
        if (!cancelled) {
          setAllOrders(Array.isArray(orders) ? orders : [])
        }
      } catch (err) {
        console.error('Failed to load customer details:', err)
        if (!cancelled) {
          setError(err.message || 'Failed to load customer details')
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    loadCustomer()
    return () => {
      cancelled = true
    }
  }, [customerId])


  if (loading) {
    return (
      <div className="customer-details-page">
        <button className="back-button" onClick={() => navigate('/customers')}>
          ← Back to Customers
        </button>
        <p>Loading customer details...</p>
      </div>
    )
  }

  if (error || !customer) {
    return (
      <div className="customer-details-page">
        <button className="back-button" onClick={() => navigate('/customers')}>
          ← Back to Customers
        </button>
        <h2>{error ? 'Unable to load customer' : 'Customer not found'}</h2>
        {error && <p>{error}</p>}
        {error && (
          <button onClick={() => window.location.reload()}>Retry</button>
        )}
      </div>
    )
  }

  const customerOrders = allOrders.map((order) => {
    const rawAmount = order.amount ?? order.total_amount ?? 0

    return {
      ...order,
      id: order.id ?? order.order_id,
      product:
        order.product ??
        order.product_name ??
        order.items?.map((item) => item.product_name ?? item.name).join(', ') ??
        '—',
      date: order.date ?? order.created_at ?? '—',
      status: order.status ?? 'Unknown',
      amount:
        typeof rawAmount === 'number'
          ? rawAmount
          : Number(String(rawAmount).replace(/[₹,\s]/g, '')) || 0,
    }
  })

  const initials = customer.name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase()

  return (
    <div className="customer-details-page">
      <button
        className="back-button"
        onClick={() => navigate('/customers')}
      >
        ← Back to Customers
      </button>

      <section className="customer-profile-card">
        <div className="customer-profile-heading">
          <div className="large-avatar">{initials}</div>

          <div className="customer-heading-text">
            <span className="profile-eyebrow">CUSTOMER PROFILE</span>
            <h1>{customer.name}</h1>
            <p>Customer contact information</p>
          </div>

          <button
  className="update-customer-btn"
  onClick={() => navigate(`/customers/${customerId}/edit`)}
>
  Edit Customer
</button>
        </div>

        <div className="customer-contact-grid">
          <div className="contact-item">
            <span className="contact-icon">☎</span>
            <div>
              <span className="contact-label">Phone number</span>
              <strong>{customer.phone || 'Not provided'}</strong>
            </div>
          </div>

          <div className="contact-item">
            <span className="contact-icon">✉</span>
            <div>
              <span className="contact-label">Email address</span>
              <strong className="contact-value">
                {customer.email || 'Not provided'}
              </strong>
            </div>
          </div>

          
<div className="contact-item address-item">
  <span className="contact-icon">⌖</span>
  <div>
    <span className="contact-label">Delivery address</span>

    {addresses.length > 0 ? (
      addresses.map((address) => (
        <div key={address.id} style={{ marginBottom: '12px' }}>
          <strong className="contact-value">
            {address.profile_name}
            {address.is_default ? ' (Default)' : ''}
          </strong>

          <p>
            {[
              address.recipient_name,
              address.address_line_1,
              address.address_line_2,
              address.landmark,
              address.city,
              address.state,
              address.pincode,
            ]
              .filter(Boolean)
              .join(', ')}
          </p>

          <p>{address.recipient_phone}</p>
        </div>
      ))
    ) : (
      <strong className="contact-value">
        Address not available
      </strong>
    )}
  </div>
</div>

        </div>
      </section>
      

      <section className="orders-section">
        <div className="section-header">
          <div>
            <h2>Order History</h2>
            <p>Previous orders placed by this customer.</p>
          </div>
          <span className="order-count">
            {customerOrders.length} {customerOrders.length === 1 ? 'order' : 'orders'}
          </span>
        </div>

        <div className="table-container">
          <table>
            <thead>
              <tr>
                <th>ORDER ID</th>
                <th>PRODUCT</th>
                <th> DATE & TIME</th>
                <th>AMOUNT</th>
                <th>STATUS</th>
              </tr>
            </thead>
            <tbody>
              {customerOrders.length > 0 ? (
                customerOrders.map((order, index) => (
                  <tr key={order.id ?? index}>
                    <td className="order-id">
                      {order.id ? `#${order.id}` : '—'}
                    </td>
                    <td>{order.product}</td>
                    <td>
                      {order.date === '—'
                        ? '—'
                        : new Date(order.date).toLocaleString('en-IN')}
                    </td>
                    <td>₹{order.amount.toLocaleString('en-IN')}</td>
                    <td>
                      <span
                        className={`status ${String(order.status)
                          .toLowerCase()
                          .replace(/\s+/g, '-')}`}
                      >
                        {order.status}
                      </span>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan="5">No orders found for this customer.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}

export default CustomerDetails
