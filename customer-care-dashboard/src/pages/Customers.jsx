import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { getOrders } from '../data/orderStore'
import { getCustomers } from '../api/customerApi'
function formatPhone(phone) {
  if (!phone) return '—'

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
const initialCustomers = [
  { id: '1', name: 'Rahul', phone: '+91 98765 43210', status: 'Active', lastOrder: '#ORD-1001' },
  { id: '2', name: 'Priya', phone: '+91 98765 12345', status: 'Active', lastOrder: '#ORD-1002' },
  { id: '3', name: 'Arun', phone: '+91 91234 56789', status: 'Active', lastOrder: '#ORD-1003' },
  { id: '4', name: 'Sneha', phone: '+91 99887 66554', status: 'Active', lastOrder: '#ORD-1004' },
]

function Customers() {
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()

  const [customers, setCustomers] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [showAddForm, setShowAddForm] = useState(
    searchParams.get('add') === 'true'
  )
  const [savedCustomers, setSavedCustomers] = useState(() => {
    try {
      return JSON.parse(
        localStorage.getItem('customer_care_customers') || '{}'
      )
    } catch {
      return {}
    }
  })

  const [newCustomer, setNewCustomer] = useState({
    name: '',
    phone: '',
    email: '',
  })

  
useEffect(() => {
  const loadCustomers = async () => {
    try {
      setLoading(true)
      setError('')

      const data = await getCustomers()
      setCustomers(data)
    } catch (err) {
      console.error('Failed to load customers:', err)
      setError(err.message || 'Failed to load customers')
    } finally {
      setLoading(false)
    }
  }

  loadCustomers()
}, [])


  useEffect(() => {
    setShowAddForm(searchParams.get('add') === 'true')
  }, [searchParams])

  const closeForm = () => {
    setShowAddForm(false)
    setSearchParams({})
    setNewCustomer({ name: '', phone: '', email: '' })
  }

  const handleSaveCustomer = (event) => {
    event.preventDefault()

    const name = newCustomer.name.trim()
    const phone = newCustomer.phone.trim()
    const email = newCustomer.email.trim()

    if (!name || !phone) {
      alert('Please enter the customer name and phone number.')
      return
    }

    const digits = phone.replace(/\D/g, '')
    if (digits.length < 10 || digits.length > 15) {
      alert('Please enter a valid phone number.')
      return
    }

    const duplicatePhone = [
      ...initialCustomers,
      ...Object.values(savedCustomers),
    ].some(
      (customer) =>
        customer.phone?.replace(/\D/g, '') === digits
    )

    if (duplicatePhone) {
      alert('A customer with this phone number already exists.')
      return
    }

    // Temporary local demo record.
    // The backend will assign the real Customer ID later.
    const recordKey = `manual-${Date.now()}`
    const updatedCustomers = {
      ...savedCustomers,
      [recordKey]: {
        name,
        phone,
        email,
        status: 'Active',
        lastOrder: '—',
        customerId: null,
        pendingBackendCreation: true,
      },
    }

    localStorage.setItem(
      'customer_care_customers',
      JSON.stringify(updatedCustomers)
    )

    setSavedCustomers(updatedCustomers)
    closeForm()
    alert(
      'Customer saved locally for demo. It has not been created in the backend yet.'
    )
  }

  
const allCustomers = [
  ...initialCustomers.map((customer) => ({
    ...customer,
    ...(savedCustomers[customer.id] || {}),
    id: customer.id,
  })),

  ...Object.entries(savedCustomers)
    .filter(
      ([key]) => !initialCustomers.some((customer) => customer.id === key)
    )
    .map(([key, customer]) => ({
      ...customer,
      id: key,
    })),
]

const customerData = customers.map((customer) => ({
  ...customer,
  name: customer.name || `Customer ${customer.id}`,
  phone: customer.whatsapp_number || '—',
  email: customer.email || '—',
  customerId: customer.id,
  orders: customer.total_orders ?? 0,
  lastOrder: customer.last_order
    ? new Date(customer.last_order).toLocaleDateString()
    : '—',
  status: 'Active',
}))


  const filteredCustomers = customerData.filter((customer) => {
  const searchText = search.toLowerCase()

  const matchesSearch =
    customer.name.toLowerCase().includes(searchText) ||
    customer.phone.toLowerCase().includes(searchText) ||
    String(customer.lastOrder).toLowerCase().includes(searchText)

  const matchesStatus =
    statusFilter === 'all' ||
    customer.status.toLowerCase() === statusFilter

  return matchesSearch && matchesStatus
})

  return (
    <div className="customers-page">
      <div className="page-heading">
        <div>
          <h2>Customers</h2>
          <p>View and manage customer information and order history.</p>
        </div>
      </div>

      <div className="customer-toolbar">
        <input
          type="text"
          placeholder="Search by name, phone ..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />

        <select
          className="filter-button"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
        >
          <option value="all">All Status</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
        </select>
      </div>

      {showAddForm && (
        <div className="customer-form-overlay">
          <form
            className="customer-form-modal"
            onSubmit={handleSaveCustomer}
          >
            <div className="customer-form-heading">
              <div>
                <h2>New Customer</h2>
                <p>Enter the customer's information below.</p>
              </div>
              <button
                type="button"
                className="form-close-btn"
                onClick={closeForm}
                aria-label="Close form"
              >
                ×
              </button>
            </div>

            <label>
              Customer Name <span>*</span>
              <input
                value={newCustomer.name}
                onChange={(e) =>
                  setNewCustomer({
                    ...newCustomer,
                    name: e.target.value,
                  })
                }
                placeholder="Enter full name"
                required
                autoFocus
              />
            </label>

            <label>
              Phone Number <span>*</span>
              <input
                type="tel"
                value={newCustomer.phone}
                onChange={(e) =>
                  setNewCustomer({
                    ...newCustomer,
                    phone: e.target.value,
                  })
                }
                placeholder="+91 XXXXX XXXXX"
                required
              />
            </label>

            <label>
              Email <span className="optional-label">(Optional)</span>
              <input
                type="email"
                value={newCustomer.email}
                onChange={(e) =>
                  setNewCustomer({
                    ...newCustomer,
                    email: e.target.value,
                  })
                }
                placeholder="customer@example.com"
              />
            </label>

            

            <div className="customer-form-actions">
              <button
                type="button"
                className="cancel-form-btn"
                onClick={closeForm}
              >
                Cancel
              </button>
              <button type="submit" className="save-customer-btn">
                Save Customer
              </button>
            </div>
          </form>
        </div>
      )}

      <div className="customers-section">
        <div className="section-header">
          <div>
            <h2>All Customers</h2>
            <p>{filteredCustomers.length} customers</p>
          </div>
        </div>

        <div className="table-container">
          <table>
            <thead>
              <tr>
                <th>CUSTOMER</th>
                <th>PHONE</th>
                                <th>EMAIL</th>
                <th>TOTAL ORDERS</th>
                <th>LAST ORDER</th>
                <th>STATUS</th>
                <th>ACTION</th>
              </tr>
            </thead>

            <tbody>
              {filteredCustomers.length > 0 ? (
                filteredCustomers.map((customer) => (
                  <tr key={customer.id}>
                    <td>
                      <div className="customer-name">
                        <div className="customer-avatar">
                          {customer.name.charAt(0).toUpperCase()}
                        </div>
                        <span>{customer.name}</span>
                      </div>
                    </td>
                    <td>{formatPhone(customer.phone || customer.whatsapp_number)}</td>
                    <td>{customer.email || '—'}</td>
                    <td>{customer.orders}</td>
                    <td className="order-id">{customer.lastOrder}</td>
                    <td>
                      <span className="customer-status">
                        {customer.status || 'Active'}
                      </span>
                    </td>
                    <td>
                      <button
                        className="view-button"
                        onClick={() =>
                          navigate(`/customers/${customer.id}`)
                        }
                      >
                        View
                      </button>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td
                    colSpan="7"
                    style={{
                      textAlign: 'center',
                      padding: '30px',
                      color: '#6b7280',
                    }}
                  >
                    No customers found
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

export default Customers
