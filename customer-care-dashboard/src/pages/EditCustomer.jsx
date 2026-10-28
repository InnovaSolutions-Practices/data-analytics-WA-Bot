import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  getCustomerById,
  updateCustomer,
  getCustomerAddresses,
  createCustomerAddress,
  setDefaultCustomerAddress,
} from '../api/customerApi'

function EditCustomer() {
  const navigate = useNavigate()
  const { customerId } = useParams()

  const [customer, setCustomer] = useState(null)
  const [form, setForm] = useState({
    name: '',
    email: '',
    address: '',
  })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [addressError, setAddressError] = useState('')
  const [addresses, setAddresses] = useState([])
  const [customerSuccess, setCustomerSuccess] = useState('')
const [addressForm, setAddressForm] = useState({
  profile_name: '',
  recipient_name: '',
  recipient_phone: '',
  email: '',
  address_line_1: '',
  address_line_2: '',
  city: '',
  state: '',
  pincode: '',
  landmark: '',
  is_default: false,
})
const [addressSaving, setAddressSaving] = useState(false)

  useEffect(() => {
    let cancelled = false

    async function loadCustomer() {
      try {
        const data = await getCustomerById(customerId)
        if (cancelled) return

        setCustomer(data)
        setForm({
          name: data.name || '',
          email: data.email || '',
          address:
            data.address?.address_line ||
            data.address?.full_address ||
            data.profile?.address ||
            data.metadata?.address ||
            '',
        })
        const savedAddresses = await getCustomerAddresses(customerId)

      if (cancelled) return

      setAddresses(savedAddresses)
      } catch (err) {
        if (!cancelled) {
          setError(err.message || 'Unable to load customer.')
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
  

  function updateField(event) {
    const { name, value } = event.target
    setForm((previous) => ({ ...previous, [name]: value }))
    setError('')
    setSuccess('')
  }

  async function handleSubmit(event) {
    setCustomerSuccess('')
    event.preventDefault()
    setSaving(true)
    setError('')
    setSuccess('')

    try {
      // Update name and email through the existing customer API.
      const updated = await updateCustomer(customerId, {
        name: form.name.trim(),
        email: form.email.trim() || null,
      })

      setCustomer((previous) => ({ ...previous, ...updated }))
setCustomerSuccess('Customer details saved successfully.')
      // Address is displayed in the form, but is not sent until
      // the backend's supported address-update field is confirmed.
    } catch (err) {
      setError(err.message || 'Unable to save customer details.')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return <div className="customer-details-page "><p>Loading customer...</p></div>
  }

  if (!customer) {
    return (
      <div className="customer-details-page  edit-customer-page">
        <h2>Unable to load customer</h2>
        {error && <p>{error}</p>}
        <button onClick={() => navigate('/customers')}>Back to Customers</button>
      </div>
    )
  }

  return (
    <div className="customer-details-page">
      <button
        type="button"
        className="back-button"
        onClick={() => navigate(`/customers/${customerId}`)}
      >
        ← Back to Customer
      </button>

      <section className="customer-profile-card">
        <div className="customer-profile-heading edit-page-heading">
  <div className="customer-heading-text">
    <span className="profile-eyebrow">CUSTOMER MANAGEMENT</span>
    <h1>Edit Customer</h1>
    <p>Update customer contact details.</p>
  </div>

  <div className="customer-save-actions">
    <button
      type="button"
      className="save-customer-top-btn"
      disabled={saving}
      onClick={() =>
        document.getElementById('customer-save-form')?.requestSubmit()
      }
    >
      {saving ? 'Saving...' : 'Save Changes'}
    </button>

    {customerSuccess && (
      <p className="customer-save-success" role="status">
        ✓ {customerSuccess}
      </p>
    )}
  </div>
</div>
<form
  id="customer-save-form"
  onSubmit={handleSubmit}
  className="edit-customer-panel"
>          <label>
            Customer ID
            <input value={customer.id ?? customerId} readOnly />
          </label>

          <label>
            Phone Number (read-only)
            <input
              value={customer.whatsapp_number || 'Not provided'}
              readOnly
            />
          </label>

          <label>
            Customer Name
            <input
              name="name"
              value={form.name}
              onChange={updateField}
              required
              maxLength={100}
            />
          </label>

          <label>
            Email Address
            <input
              type="email"
              name="email"
              value={form.email}
              onChange={updateField}
            />
          </label>
          </form>
<h2>Delivery Addresses</h2>

{addresses.map((address) => (
  <div key={address.id} className="contact-item">
    <div>
      <strong>
        {address.profile_name}
        {address.is_default ? ' (Default)' : ''}
      </strong>
      <p>
        {[
          address.address_line_1,
          address.address_line_2,
          address.city,
          address.state,
          address.pincode,
        ].filter(Boolean).join(', ')}
      </p>

      {!address.is_default && (
        <button
          type="button"
          disabled={addressSaving}
          onClick={async () => {
            try {
              setAddressSaving(true)
              await setDefaultCustomerAddress(customerId, address.id)
              setAddresses(await getCustomerAddresses(customerId))
              setSuccess('Default address updated.')
              setError('')
            } catch (err) {
  const message = err.message || ''

  if (
    message.toLowerCase().includes('duplicate') ||
    message.includes('23505') ||
    message.toLowerCase().includes('unique constraint') ||
    message.toLowerCase().includes('already exists')
  ) {
    setError(
      'This address profile name already exists. Please choose a different name.'
    )
  } else {
    setError('Could not add the delivery address. Please try again.')
  }
} finally {
  setAddressSaving(false)
}
          }}
        >
          Set as Default
        </button>
      )}
    </div>
  </div>
))}

<h3>Add Delivery Address</h3>
<div className="delivery-address-form">
  

{[
  ['profile_name', 'Profile Name (Home/Office)'],
  ['recipient_name', 'Recipient Name'],
  ['recipient_phone', 'Recipient Phone'],
  ['email', 'Email'],
  ['address_line_1', 'Address Line 1'],
  ['address_line_2', 'Address Line 2'],
  ['city', 'City'],
  ['state', 'State'],
  ['pincode', '6-digit PIN Code'],
  ['landmark', 'Landmark'],
].map(([name, label]) => (
  <label key={name}>
    {label}
    <input
      value={addressForm[name]}
      required={[
        'profile_name',
        'recipient_name',
        'recipient_phone',
        'address_line_1',
        'city',
        'state',
        'pincode',
      ].includes(name)}
      maxLength={name === 'pincode' ? 6 : undefined}
      inputMode={name === 'pincode' || name === 'recipient_phone' ? 'numeric' : undefined}
      pattern={name === 'pincode' ? '[0-9]{6}' : undefined}
      onChange={(event) =>
        setAddressForm((previous) => ({
          ...previous,
          [name]: event.target.value,
        }))
      }
    />
  </label>
))}
</div>
<button
  type="button"
  className="add-delivery-address-btn"
  disabled={addressSaving}
  onClick={async () => {
  setAddressSaving(true)
  setAddressError('')
  setSuccess('')

  const payload = {
    ...addressForm,
    profile_name: addressForm.profile_name.trim(),
    recipient_name: addressForm.recipient_name.trim(),
    recipient_phone: addressForm.recipient_phone.trim(),
    address_line_1: addressForm.address_line_1.trim(),
    city: addressForm.city.trim(),
    state: addressForm.state.trim(),
    pincode: addressForm.pincode.trim(),
    is_default: false,
  }

  let saved = false

  try {
    await createCustomerAddress(customerId, payload)
    saved = true

    setSuccess('Delivery address added successfully.')

    setAddressForm({
      profile_name: '',
      recipient_name: '',
      recipient_phone: '',
      email: '',
      address_line_1: '',
      address_line_2: '',
      city: '',
      state: '',
      pincode: '',
      landmark: '',
      is_default: false,
    })

    try {
      const refreshedAddresses = await getCustomerAddresses(customerId)
      setAddresses(refreshedAddresses)
    } catch (refreshError) {
      console.error('Address saved, but list refresh failed:', refreshError)
      setAddressError(
        'Address saved successfully, but the list could not refresh. Reload the page.'
      )
    }
  } catch (err) {
    console.error('Address creation request failed:', err)
    setAddressError(
      saved
        ? 'Address saved, but a later operation failed.'
        : err.message || 'Could not add the delivery address.'
    )
  } finally {
    setAddressSaving(false)
  }
}}
>
  {addressSaving ? 'Saving Address...' : 'Add Delivery Address'}

</button>
          {addressError && <p className="edit-error">{addressError}</p>}
{success && <p role="status">{success}</p>}

          
      </section>
      </div>
  )
}

export default EditCustomer
