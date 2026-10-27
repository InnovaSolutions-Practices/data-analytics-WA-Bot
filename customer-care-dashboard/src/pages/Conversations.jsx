
import { useEffect, useMemo, useState } from 'react'
import {
  getAllOrders,
  getAllConversations,
  getCustomers,
  getAllCarts,
} from '../api/customerApi'

function normalizePhone(phone) {
  return String(phone ?? '').replace(/\D/g, '')
}

function formatPhone(phone) {
  const digits = normalizePhone(phone)
  if (!digits) return 'Unknown number'

  const local =
    digits.startsWith('91') && digits.length === 12
      ? digits.slice(2)
      : digits

  return `+91 ${local}`
}

function formatDate(value) {
  if (!value) return '—'

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'

  return date.toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function readableState(value) {
  return String(value || '')
    .replaceAll('_', ' ')
    .toLowerCase()
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function isMessageReference(value) {
  return String(value || '').startsWith('wamid.')
}

function getReadableActivity(conversation) {
  const message = conversation.latestState?.last_message
  const context = conversation.context

  if (message && !isMessageReference(message)) return message
  if (context?.last_product) return `Product: ${context.last_product}`
  if (context?.last_intent) return readableState(context.last_intent)

  const source = conversation.latestState?.context?.source
  if (source) return readableState(source)

  return 'No readable message available'
}

function Conversations() {
  const [contexts, setContexts] = useState([])
  const [states, setStates] = useState([])
  const [customers, setCustomers] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [stateFilter, setStateFilter] = useState('all')
  const [selectedKey, setSelectedKey] = useState(null)
  const [refreshing, setRefreshing] = useState(false);
  const [orders, setOrders] = useState([]);
  const [refreshMessage, setRefreshMessage] = useState('');
const [refreshStatus, setRefreshStatus] = useState('');
useEffect(() => {
  if (!refreshMessage || refreshStatus !== 'success') return;

  const timer = setTimeout(() => {
    setRefreshMessage('');
    setRefreshStatus('');
  }, 3000);

  return () => clearTimeout(timer);
}, [refreshMessage, refreshStatus]);

const handleRefresh = async () => {
  try {
    setRefreshing(true);
    setError('');
    setRefreshStatus('success');
setRefreshMessage('Conversations refreshed successfully!');
    const [conversationData, customerData, orderData] =
      await Promise.all([
        getAllConversations(),
        getCustomers(),
        getAllOrders(),
      ]);

    setContexts(conversationData.contexts || []);
    setStates(conversationData.states || []);
    setCustomers(Array.isArray(customerData) ? customerData : []);
    setOrders(Array.isArray(orderData) ? orderData : []);

    setRefreshStatus('success');
    setRefreshMessage('Conversations refreshed successfully!');
  } catch (err) {
    console.error('Failed to refresh conversations:', err);
    setRefreshStatus('error');
    setRefreshMessage('Refresh failed. Please try again.');
  } finally {
    setRefreshing(false);
  }
};

  useEffect(() => {
    let cancelled = false

    async function loadData() {
      try {
        setLoading(true)
        setError('')

        const [conversationData, customerData, orderData, cartData] =
  await Promise.all([
    getAllConversations(),
    getCustomers(),
    getAllOrders(),
    getAllCarts(),
  ]);

if (cancelled) return;

setContexts(conversationData.contexts || []);
setStates(conversationData.states || []);
setCustomers(Array.isArray(customerData) ? customerData : []);
setOrders(Array.isArray(orderData) ? orderData : []);

        if (cancelled) return

        setContexts(conversationData.contexts || [])
        setStates(conversationData.states || [])
        setCustomers(Array.isArray(customerData) ? customerData : [])
      } catch (err) {
        console.error('Failed to load conversations:', err)
        if (!cancelled) {
          setError('Could not load conversations. Please try again.')
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    loadData()

    return () => {
      cancelled = true
    }
  }, [])

  const conversations = useMemo(() => {
    const phoneMap = new Map()

    function getEntry(phone) {
      if (!phoneMap.has(phone)) {
        phoneMap.set(phone, {
          phone,
          context: null,
          states: [],
        })
      }

      return phoneMap.get(phone)
    }

    for (const item of contexts) {
      const phone = normalizePhone(item.phone_number)
      if (!phone) continue

      const entry = getEntry(phone)

      if (
        !entry.context ||
        new Date(item.updated_at || 0) >
          new Date(entry.context.updated_at || 0)
      ) {
        entry.context = item
      }
    }

    for (const item of states) {
      const phone = normalizePhone(item.whatsapp_number)
      if (!phone) continue

      getEntry(phone).states.push(item)
    }

    return Array.from(phoneMap.values())
      .map((entry) => {
        const sortedStates = [...entry.states].sort(
          (a, b) =>
            new Date(b.updated_at || b.created_at || 0) -
            new Date(a.updated_at || a.created_at || 0)
        )

        const latestState = sortedStates[0] || null

        return {
          ...entry,
          states: sortedStates,
          latestState,
          lastUpdated:
            latestState?.updated_at ||
            entry.context?.updated_at ||
            null,
        }
      })
      .sort(
        (a, b) =>
          new Date(b.lastUpdated || 0) -
          new Date(a.lastUpdated || 0)
      )
  }, [contexts, states])

  const filteredConversations = useMemo(() => {
    const query = search.trim().toLowerCase()

    return conversations.filter((item) => {
      const context = item.context || {}
      const latest = item.latestState || {}

      const matchesSearch = [
        item.phone,
        context.last_product,
        context.last_order_id,
        context.last_intent,
        latest.state,
        isMessageReference(latest.last_message) ? '' : latest.last_message,
        latest.context?.source,
        latest.context?.order_id,
      ].some((value) =>
        String(value ?? '').toLowerCase().includes(query)
      )

      const matchesState =
        stateFilter === 'all' ||
        item.latestState?.state === stateFilter

      return matchesSearch && matchesState
    })
  }, [conversations, search, stateFilter])

  const selectedConversation =
    filteredConversations.find((item) => item.phone === selectedKey) ||
    conversations.find((item) => item.phone === selectedKey) ||
    null

  useEffect(() => {
    if (
      filteredConversations.length > 0 &&
      !filteredConversations.some((item) => item.phone === selectedKey)
    ) {
      setSelectedKey(filteredConversations[0].phone)
    } else if (filteredConversations.length === 0) {
      setSelectedKey(null)
    }
  }, [filteredConversations, selectedKey])

  const selectedCustomer = customers.find(
    (customer) =>
      normalizePhone(customer.whatsapp_number) ===
      selectedConversation?.phone
  )

  const stateOptions = useMemo(
    () =>
      [...new Set(
        conversations
          .map((item) => item.latestState?.state)
          .filter(Boolean)
      )].sort(),
    [conversations]
  )

  const customerCareCount = conversations.filter(
    (item) => item.latestState?.state === 'CUSTOMER_CARE'
  ).length

  const orderQueryCount = conversations.filter((item) =>
    [
      'TRACK_ORDER',
      'DELIVERY_QUERY',
      'INVENTORY_QUERY',
    ].includes(item.context?.last_intent)
  ).length

  const issue =
  selectedConversation?.latestState?.context?.source ||
  selectedConversation?.context?.last_intent ||
  null;

const customerOrders = selectedCustomer
  ? orders
      .filter(
        (order) =>
          Number(order.customer_id) === Number(selectedCustomer.id)
      )
      .sort(
        (a, b) =>
          new Date(b.created_at || 0) -
          new Date(a.created_at || 0)
      )
  : [];

const latestOrder = customerOrders[0] || null;

const orderReference =
  latestOrder?.id ??
  selectedConversation?.latestState?.context?.order_id ??
  selectedConversation?.context?.last_order_id ??
  null;
const lastProduct =
  selectedConversation?.context?.last_product || null;

  return (
    <div className="conversations-page">
      <div className="page-heading">
        <div>
          <h2>Conversations</h2>
          <p>Monitor customer activity from your WhatsApp bot.</p>
        </div>
      </div>

      <div className="product-stats">
        <div className="product-stat-card">
          <span>Customers</span>
          <strong>{loading ? '—' : conversations.length}</strong>
          <small>Unique WhatsApp numbers</small>
        </div>

        <div className="product-stat-card">
          <span>Customer Care</span>
          <strong>{loading ? '—' : customerCareCount}</strong>
          <small>Currently in customer care state</small>
        </div>

        <div className="product-stat-card">
          <span>Order Queries</span>
          <strong>{loading ? '—' : orderQueryCount}</strong>
          <small>Based on recorded intent</small>
        </div>

        <div className="product-stat-card">
          <span>State Records</span>
          <strong>{loading ? '—' : states.length}</strong>
          <small>Stored bot-state records</small>
        </div>
      </div>

      <div className="conversation-toolbar">
        <input
          type="search"
          placeholder="Search phone, product, order, intent or message..."
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />

        <select
          value={stateFilter}
          onChange={(event) => setStateFilter(event.target.value)}
        >
          <option value="all">All states</option>
          {stateOptions.map((state) => (
            <option key={state} value={state}>
              {readableState(state)}
            </option>
          ))}
        </select>
      </div>

      {error && (
        <div role="alert" className="conversation-error">
          {error}
        </div>
      )}

      <div className="conversation-layout">
        <aside className="conversation-list">
          <div className="conversation-list-header">
            <h3>Inbox</h3>
            <span>{filteredConversations.length}</span>
          </div>

          {loading ? (
            <p className="conversation-empty">Loading conversations...</p>
          ) : filteredConversations.length > 0 ? (
            filteredConversations.map((item) => {
              const latest = item.latestState
              const customer = customers.find(
                (entry) =>
                  normalizePhone(entry.whatsapp_number) === item.phone
              )

              return (
                <button
                  type="button"
                  key={item.phone}
                  className={`conversation-item ${
                    selectedKey === item.phone ? 'selected' : ''
                  }`}
                 onClick={() => {
  setSelectedKey(item.phone);
  setRefreshMessage('');
  setRefreshStatus('');
}}
                >
                  <span className="conversation-avatar">
                    {(customer?.name || item.phone).slice(-2).toUpperCase()}
                  </span>

                  <span className="conversation-item-content">
                    <span className="conversation-item-top">
                      <strong>
                        {customer?.name || formatPhone(item.phone)}
                      </strong>
                      <small>{formatDate(item.lastUpdated)}</small>
                    </span>

                    <span className="conversation-preview">
                      {getReadableActivity(item)}
                    </span>

                    <span
                      className={`status ${
                        latest?.state === 'CUSTOMER_CARE'
                          ? 'active'
                          : 'inactive'
                      }`}
                    >
                      {readableState(latest?.state || 'NO STATE')}
                    </span>
                  </span>
                </button>
              )
            })
          ) : (
            <p className="conversation-empty">
              {error
                ? 'Conversation data could not be loaded.'
                : 'No conversations match your search.'}
            </p>
          )}
        </aside>

        <section className="conversation-details">
          {selectedConversation ? (
            <>
              <header className="chat-header">
                <div className="chat-customer">
                  <span className="conversation-avatar">
                    {(selectedCustomer?.name ||
                      selectedConversation.phone).slice(-2).toUpperCase()}
                  </span>

                  <div>
                    <h3>
                      {selectedCustomer?.name ||
                        formatPhone(selectedConversation.phone)}
                    </h3>
                    <p>{formatPhone(selectedConversation.phone)}</p>
                  </div>
                </div>
              </header>

              <div className="chat-messages conversation-activity">
                <div className="activity-timeline-heading">
                  <div>
                    <h3>Activity timeline</h3>
                    <p>Recorded activity from the WhatsApp bot</p>
                  </div>
                  <button
  type="button"
  className="activity-timeline-count activity-refresh-button"
  onClick={handleRefresh}
  disabled={refreshing}
  title="Refresh conversation data"
>
  {refreshing ? 'Refreshing...' : '↻ Refresh'}
</button>
                </div>
                {refreshMessage && (
  <div
    className={`refresh-toast ${refreshStatus}`}
    role="status"
  >
    {refreshStatus === 'success' ? '✓ ' : '⚠ '}
    {refreshMessage}
  </div>
)}

                {selectedConversation.latestState && (
                  <div className="activity-timeline-list">
                    <div className="activity-timeline-marker" aria-hidden="true">
<span>◷</span>
                    </div>
                    <article className="activity-timeline-event">
                      <div className="activity-timeline-event-top">
                        <div>
<h4>Customer bot state</h4>
                          <p>
                            {formatDate(
                              selectedConversation.latestState.updated_at ||
                              selectedConversation.latestState.created_at
                            )}
                          </p>
                        </div>
                        <span className="activity-state-pill">
                          {readableState(selectedConversation.latestState.state || 'Unknown')}
                        </span>
                      </div>
                    </article>
                  </div>
                )}

                {(() => {
                  const message = selectedConversation.latestState?.last_message
                  const readableMessage =
                    message && !isMessageReference(message) ? message : ''

                  return readableMessage ? (
                    <div className="activity-timeline-list message-event">
                      <div className="activity-timeline-marker message-marker" aria-hidden="true">
                        <span>✉</span>
                      </div>
                      <article className="activity-timeline-event">
                        <div className="activity-timeline-event-top">
                          <div>
                            <h4>Latest message</h4>
                            <p>From the conversation record</p>
                          </div>
                        </div>
                        <p className="activity-timeline-message">{readableMessage}</p>
                      </article>
                    </div>
                  ) : null
                })()}

                {!selectedConversation.latestState && (
                  <div className="activity-timeline-empty">
                    <span className="activity-empty-icon">◷</span>
                    <h4>No activity recorded</h4>
                    <p>There are no bot-state records available for this number.</p>
                  </div>
                )}

                <div className="activity-timeline-note">
                  <span>ⓘ</span>
                  <p>This timeline shows available bot-state records. Full WhatsApp chat history is not provided by the current API.</p>
                </div>
              </div>
            </>
          ) : (
            <div className="empty-conversation">
              <h3>
                {loading ? 'Loading conversations...' : 'Select a customer'}
              </h3>
              <p>
                Select a customer from the inbox to view their recorded
                activity.
              </p>
            </div>
          )}
        </section>

        {selectedConversation && (
          <aside className="conversation-customer-panel">
            <div className="customer-profile-avatar">
              {(selectedCustomer?.name ||
                selectedConversation.phone).slice(-2).toUpperCase()}
            </div>

            <h3>
              {selectedCustomer?.name || 'WhatsApp Customer'}
            </h3>
            <p>{formatPhone(selectedConversation.phone)}</p>

            <div className="customer-info-row">
              <span>Customer match</span>
              <strong>
                {selectedCustomer ? 'Linked' : 'Not linked'}
              </strong>
            </div>

            <div className="customer-info-row">
              <span>Email</span>
              <strong>
                {selectedCustomer?.email || 'Not available'}
              </strong>
            </div>

            <div className="customer-info-row">
              <span>Customer ID</span>
              <strong>{selectedCustomer?.id ?? 'Not linked'}</strong>
            </div>

            <div className="customer-info-row">
              <span>Total orders</span>
              <strong>
                {selectedCustomer
                  ? selectedCustomer.total_orders ?? 0
                  : '—'}
              </strong>
            </div>

            <div className="customer-info-row">
              <span>Current state</span>
              <strong>
                {readableState(
                  selectedConversation.latestState?.state ||
                  'Not recorded'
                )}
              </strong>
            </div>

            <div className="customer-info-row">
              <span>Issue / intent</span>
              <strong>
                {issue ? readableState(issue) : 'Not recorded'}
              </strong>
            </div>
            {latestOrder && (
  <>
    <div className="customer-info-row">
      <span>Latest order amount</span>
      <strong>
        ₹{Number(
          latestOrder.total_amount ?? latestOrder.subtotal ?? 0
        ).toLocaleString('en-IN')}
      </strong>
    </div>

    <div className="customer-info-row">
      <span>Latest order status</span>
      <strong>
        {readableState(latestOrder.status || 'Unknown')}
      </strong>
    </div>
  </>
)}

            <div className="customer-info-row">
              <span>Order reference</span>
              <strong>
                {orderReference != null
                  ? `#${orderReference}`
                  : 'Not recorded'}
              </strong>
            </div>

            <div className="customer-info-row">
              <span>Last product</span>
              <strong>
                {selectedConversation.context?.last_product ||
                  'Not recorded'}
              </strong>
            </div>

            <div className="customer-info-row">
              <span>Last activity</span>
              <strong>
                {formatDate(selectedConversation.lastUpdated)}
              </strong>
            </div>

            <div className="customer-info-row">
              <span>Customer since</span>
              <strong>
                {formatDate(selectedCustomer?.created_at)}
              </strong>
            </div>
          </aside>
        )}
      </div>
    </div>
  )
}

export default Conversations
