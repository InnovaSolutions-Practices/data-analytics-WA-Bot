
import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  createCustomerOrder,
  getAllProducts,
  getCustomerById,
  getCustomerHistory,
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
  const [history, setHistory] = useState({})
  const [showOrderForm, setShowOrderForm] = useState(false)
  const [products, setProducts] = useState([])
  const [loadingProducts, setLoadingProducts] = useState(false)
  const [savingOrder, setSavingOrder] = useState(false)
  const [orderError, setOrderError] = useState('')
  const [orderMessage, setOrderMessage] = useState('')
  const [orderForm, setOrderForm] = useState({
    product_id: '',
    quantity: '1',
    unit_price: '',
    notes: '',
    initial_status: 'pending',
    recipient_name: '',
    recipient_phone: '',
    address_line_1: '',
    address_line_2: '',
    city: '',
    state: '',
    pincode: '',
    landmark: '',
  })

  useEffect(() => {
    let cancelled = false

    async function loadCustomer() {
      try {
        setLoading(true)
        setError('')

        const data = await getCustomerById(customerId)
        if (cancelled) return

        const customerRecord = {
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
        }
        setCustomer(customerRecord)
        setOrderForm((previous) => ({
          ...previous,
          recipient_name: customerRecord.name,
          recipient_phone: data.whatsapp_number || '',
        }))
        const [customerAddresses, customerHistory] = await Promise.all([
          getCustomerAddresses(customerId),
          getCustomerHistory(customerId),
        ])

        if (!cancelled) {
          setAddresses(customerAddresses)
          setHistory(customerHistory ?? {})
          setAllOrders(Array.isArray(customerHistory?.orders) ? customerHistory.orders : [])
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
    const items = Array.isArray(order.order_items) ? order.order_items : []

    return {
      ...order,
      id: order.id ?? order.order_id,
      product:
        items.map((item) => item.product_name).filter(Boolean).join(', ') ||
        (order.product ??
          order.product_name ??
          order.items?.map((item) => item.product_name ?? item.name).join(', ') ??
          '—'),
      quantity: items.length
        ? items.reduce((total, item) => total + Number(item.quantity || 0), 0)
        : order.quantity ?? 1,
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

  const openOrderForm = async () => {
    setShowOrderForm(true)
    setOrderError('')
    setOrderMessage('')
    if (products.length > 0) return

    try {
      setLoadingProducts(true)
      const availableProducts = await getAllProducts()
      setProducts((Array.isArray(availableProducts) ? availableProducts : []).filter(
        (product) => product.is_active
      ))
    } catch (err) {
      setOrderError(err.message || 'Could not load products.')
    } finally {
      setLoadingProducts(false)
    }
  }

  const handleProductChange = (event) => {
    const productId = event.target.value
    const product = products.find((item) => String(item.id) === productId)
    setOrderForm((previous) => ({
      ...previous,
      product_id: productId,
      unit_price: product ? String(product.price) : '',
    }))
  }

  const refreshCustomerHistory = async () => {
    const [customerHistory, customerAddresses] = await Promise.all([
      getCustomerHistory(customerId),
      getCustomerAddresses(customerId),
    ])
    setHistory(customerHistory ?? {})
    setAllOrders(Array.isArray(customerHistory?.orders) ? customerHistory.orders : [])
    setAddresses(customerAddresses)
  }

  const handleCreateOrder = async (event) => {
    event.preventDefault()
    setOrderError('')
    setOrderMessage('')
    try {
      setSavingOrder(true)
      const created = await createCustomerOrder(customerId, {
        product_id: Number(orderForm.product_id),
        quantity: Number(orderForm.quantity),
        unit_price: Number(orderForm.unit_price),
        notes: orderForm.notes,
        initial_status: orderForm.initial_status,
        delivery_address: {
          recipient_name: orderForm.recipient_name,
          recipient_phone: orderForm.recipient_phone,
          address_line_1: orderForm.address_line_1,
          address_line_2: orderForm.address_line_2,
          city: orderForm.city,
          state: orderForm.state,
          pincode: orderForm.pincode,
          landmark: orderForm.landmark,
        },
      })
      let refreshFailed = false
      try {
        await refreshCustomerHistory()
      } catch (refreshError) {
        refreshFailed = true
        console.error('Order was created, but refreshing customer history failed:', refreshError)
        setAllOrders((previous) => [{
          ...created.order,
          order_items: created.item ? [created.item] : [],
          status_history: [],
        }, ...previous])
      }
      setShowOrderForm(false)
      setOrderMessage(refreshFailed
        ? 'Order created successfully. History refresh failed; reload to see the latest details.'
        : 'Order created successfully.')
      setOrderForm((previous) => ({
        ...previous,
        product_id: '',
        quantity: '1',
        unit_price: '',
        notes: '',
        initial_status: 'pending',
        address_line_1: '',
        address_line_2: '',
        city: '',
        state: '',
        pincode: '',
        landmark: '',
      }))
    } catch (err) {
      console.error('Failed to create customer order:', err)
      setOrderError(err.message || 'Could not create order.')
    } finally {
      setSavingOrder(false)
    }
  }

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

      {orderMessage && <p role="status" className="success-message">{orderMessage}</p>}

      {showOrderForm && (
        <div className="customer-form-overlay">
          <form className="customer-form-modal" onSubmit={handleCreateOrder}>
            <div className="customer-form-heading">
              <div>
                <h2>Create Order</h2>
                <p>Create a persisted order for {customer.name}.</p>
              </div>
              <button
                type="button"
                className="form-close-btn"
                onClick={() => setShowOrderForm(false)}
                aria-label="Close form"
              >
                ×
              </button>
            </div>

            {orderError && <p role="alert" className="error-message">{orderError}</p>}

            <label>
              Product <span>*</span>
              <select value={orderForm.product_id} onChange={handleProductChange} required>
                <option value="">{loadingProducts ? 'Loading products...' : 'Select a product'}</option>
                {products.map((product) => (
                  <option key={product.id} value={product.id}>
                    {product.name} · ₹{Number(product.price).toLocaleString('en-IN')}
                  </option>
                ))}
              </select>
            </label>

            <div className="crm-form-grid">
              <label>
                Quantity <span>*</span>
                <input
                  type="number"
                  min="1"
                  step="1"
                  value={orderForm.quantity}
                  onChange={(event) => setOrderForm({ ...orderForm, quantity: event.target.value })}
                  required
                />
              </label>
              <label>
                Unit Price (₹) <span>*</span>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={orderForm.unit_price}
                  onChange={(event) => setOrderForm({ ...orderForm, unit_price: event.target.value })}
                  required
                />
              </label>
            </div>

            <label>
              Initial Status <span>*</span>
              <select
                value={orderForm.initial_status}
                onChange={(event) => setOrderForm({ ...orderForm, initial_status: event.target.value })}
              >
                <option value="pending">Pending</option>
                <option value="paid">Paid</option>
                <option value="PACKED">Processing</option>
              </select>
            </label>

            <label>
              Delivery Address <span>*</span>
              <input
                value={orderForm.address_line_1}
                onChange={(event) => setOrderForm({ ...orderForm, address_line_1: event.target.value })}
                placeholder="Address line 1"
                required
              />
            </label>
            <label>
              Address Line 2
              <input
                value={orderForm.address_line_2}
                onChange={(event) => setOrderForm({ ...orderForm, address_line_2: event.target.value })}
              />
            </label>
            <div className="crm-form-grid">
              <label>
                City <span>*</span>
                <input value={orderForm.city} onChange={(event) => setOrderForm({ ...orderForm, city: event.target.value })} required />
              </label>
              <label>
                State <span>*</span>
                <input value={orderForm.state} onChange={(event) => setOrderForm({ ...orderForm, state: event.target.value })} required />
              </label>
              <label>
                Pincode <span>*</span>
                <input
                  inputMode="numeric"
                  pattern="[0-9]{6}"
                  maxLength="6"
                  value={orderForm.pincode}
                  onChange={(event) => setOrderForm({ ...orderForm, pincode: event.target.value })}
                  required
                />
              </label>
            </div>
            <label>
              Notes
              <textarea
                value={orderForm.notes}
                onChange={(event) => setOrderForm({ ...orderForm, notes: event.target.value })}
                maxLength="2000"
              />
            </label>

            <div className="customer-form-actions">
              <button type="button" className="cancel-form-btn" onClick={() => setShowOrderForm(false)}>
                Cancel
              </button>
              <button type="submit" className="save-customer-btn" disabled={savingOrder || loadingProducts || products.length === 0}>
                {savingOrder ? 'Creating...' : 'Create Order'}
              </button>
            </div>
          </form>
        </div>
      )}

      <section className="orders-section">
        <div className="section-header">
          <div>
            <h2>Order History</h2>
            <p>Previous orders placed by this customer.</p>
          </div>
          <span className="order-count">
            {customerOrders.length} {customerOrders.length === 1 ? 'order' : 'orders'}
          </span>
          <button className="update-customer-btn" onClick={openOrderForm}>
            + Create Order
          </button>
        </div>

        <div className="table-container">
          <table>
            <thead>
              <tr>
                <th>ORDER ID</th>
                <th>PRODUCT</th>
                <th>QUANTITY</th>
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
                    <td>{order.quantity}</td>
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
                  <td colSpan="6">No orders found for this customer.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="orders-section">
        <div className="section-header">
          <div>
            <h2>Tracking History</h2>
            <p>Recorded status changes for this customer’s orders.</p>
          </div>
        </div>
        <div className="crm-history-list">
          {(history.orders ?? []).flatMap((order) =>
            (order.status_history ?? []).map((entry) => ({
              ...entry,
              order_id: order.id,
            }))
          ).map((entry) => (
            <article className="crm-history-entry" key={entry.id}>
              <strong>Order #{entry.order_id}: {entry.previous_status || 'Created'} → {entry.new_status}</strong>
              <span>{entry.created_at ? new Date(entry.created_at).toLocaleString('en-IN') : '—'}</span>
              {entry.reason && <p>{entry.reason}</p>}
            </article>
          ))}
          {(history.orders ?? []).every((order) => !order.status_history?.length) && (
            <p>No tracking changes recorded.</p>
          )}
        </div>
      </section>

      <section className="orders-section">
        <div className="section-header">
          <div>
            <h2>Conversation History</h2>
            <p>Saved support messages and conversation context.</p>
          </div>
        </div>
        <div className="crm-history-list">
          {[
            ...(history.ticket_messages ?? []).map((message) => ({
              ...message,
              body: message.message || message.message_text || message.image_url || message.message_type,
              source: 'Ticket',
            })),
            ...(history.support_messages ?? []).map((message) => ({
              ...message,
              body: message.message_text || message.message,
              source: 'Support',
            })),
          ].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
            .map((message) => (
              <article className="crm-history-entry" key={`${message.source}-${message.id}`}>
                <strong>{message.source} · {message.sender_type || 'Message'}</strong>
                <span>{message.created_at ? new Date(message.created_at).toLocaleString('en-IN') : '—'}</span>
                <p>{message.body || 'Attachment'}</p>
              </article>
            ))}
          {(history.support_sessions ?? []).map((session) => (
            <article className="crm-history-entry" key={`session-${session.id}`}>
              <strong>Support session · {session.status}</strong>
              <span>{session.created_at ? new Date(session.created_at).toLocaleString('en-IN') : '—'}</span>
              <p>{session.summary_text || session.issue_description || session.issue_type}</p>
            </article>
          ))}
          {!history.ticket_messages?.length &&
            !history.support_messages?.length &&
            !history.support_sessions?.length &&
            !history.conversation_state && <p>No saved conversation history.</p>}
          {history.conversation_state && (
            <article className="crm-history-entry">
              <strong>Current WhatsApp conversation state · {history.conversation_state.state}</strong>
              <span>{history.conversation_state.updated_at ? new Date(history.conversation_state.updated_at).toLocaleString('en-IN') : '—'}</span>
              {history.conversation_state.last_message && <p>{history.conversation_state.last_message}</p>}
            </article>
          )}
        </div>
      </section>

      <section className="orders-section">
        <div className="section-header">
          <div>
            <h2>WhatsApp Notification History</h2>
            <p>Order notification events and their latest delivery state.</p>
          </div>
        </div>
        <div className="table-container">
          <table>
            <thead>
              <tr><th>ORDER</th><th>TYPE</th><th>STATUS</th><th>RELATED STATUS</th><th>CREATED</th></tr>
            </thead>
            <tbody>
              {(history.notification_events ?? []).length ? history.notification_events.map((event) => (
                <tr key={event.id}>
                  <td>{event.order_id ? `#${event.order_id}` : '—'}</td>
                  <td>{event.event_type}</td>
                  <td>{event.status}</td>
                  <td>{event.related_status || '—'}</td>
                  <td>{event.created_at ? new Date(event.created_at).toLocaleString('en-IN') : '—'}</td>
                </tr>
              )) : (
                <tr><td colSpan="5">No WhatsApp notification events recorded.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}

export default CustomerDetails
