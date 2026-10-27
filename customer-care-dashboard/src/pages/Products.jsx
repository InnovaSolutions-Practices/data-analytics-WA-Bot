
import { useEffect, useMemo, useState } from 'react'
import { getAllProducts, updateProduct } from '../api/customerApi'
function Products() {
  const [products, setProducts] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [selectedProduct, setSelectedProduct] = useState(null)
  const [editingProduct, setEditingProduct] = useState(null)
const [saving, setSaving] = useState(false)
const [saveError, setSaveError] = useState('')
const [saveSuccess, setSaveSuccess] = useState('')

  useEffect(() => {
    async function loadProducts() {
      try {
        setLoading(true)
        setError('')
        const data = await getAllProducts()
        setProducts(data)
      } catch (err) {
        setError('Failed to load products. Please try again.')
        console.error(err)
      } finally {
        setLoading(false)
      }
    }

    loadProducts()
  }, [])
  function startEditing(product) {
  setSelectedProduct(null)
  setSaveError('')
  setSaveSuccess('')
  setEditingProduct({
    ...product,
    price: String(product.price ?? 0),
    stock: String(product.stock ?? 0),
    description: product.description ?? '',
  })
}

async function handleSaveProduct(e) {
  e.preventDefault()
  if (!editingProduct || saving) return

  const price = Number(editingProduct.price)
  const stock = Number(editingProduct.stock)

  if (
    !editingProduct.name.trim() ||
    !Number.isFinite(price) ||
    price < 0 ||
    !Number.isInteger(stock) ||
    stock < 0
  ) {
    setSaveError('Enter a product name, valid price, and non-negative whole-number stock.')
    return
  }

  try {
    setSaving(true)
    setSaveError('')
    setSaveSuccess('')

    const updated = await updateProduct(editingProduct.id, {
      name: editingProduct.name.trim(),
      price,
      stock,
      description: editingProduct.description,
      is_active: editingProduct.is_active,
    })

    setProducts((current) =>
      current.map((p) =>
        String(p.id) === String(updated.id) ? updated : p
      )
    )

    setEditingProduct(null)
    setSaveSuccess(`${updated.name} updated successfully.`)
  } catch (err) {
    setSaveError(err.message || 'Could not save product.')
  } finally {
    setSaving(false)
  }
}

  const filteredProducts = useMemo(() => {
    const query = search.trim().toLowerCase()

    return products.filter((product) => {
      const matchesSearch =
        String(product.name ?? '').toLowerCase().includes(query) ||
        String(product.id ?? '').toLowerCase().includes(query)

      const status = product.is_active ? 'active' : 'inactive'
      const matchesStatus =
        statusFilter === 'all' || status === statusFilter

      return matchesSearch && matchesStatus
    })
  }, [products, search, statusFilter])

  const formatPrice = (price) =>
    Number(price ?? 0).toLocaleString('en-IN', {
      style: 'currency',
      currency: 'INR',
      maximumFractionDigits: 2,
    })

  const activeProducts = products.filter((p) => p.is_active).length
  const lowStock = products.filter(
    (p) => Number(p.stock ?? 0) > 0 && Number(p.stock ?? 0) <= 5
  ).length
  const outOfStock = products.filter(
    (p) => Number(p.stock ?? 0) <= 0
  ).length

  return (
    <div className="products-page">
      <div className="page-heading">
        <div>
          <h2>Products</h2>
          <p>View your product catalogue.</p>
        </div>
        <span className="status active">Live Data</span>
      </div>
      {saveSuccess && (
  <p role="status" className="product-save-success">
    {saveSuccess}
  </p>
)}

      <div className="product-stats">
        <div className="product-stat-card">
          <span>Total Products</span>
          <strong>{loading ? '—' : products.length}</strong>
          <small>Across the catalogue</small>
        </div>

        <div className="product-stat-card">
          <span>Active Products</span>
          <strong>{loading ? '—' : activeProducts}</strong>
          <small>Currently active</small>
        </div>

        <div className="product-stat-card">
          <span>Low Stock</span>
          <strong>{loading ? '—' : lowStock}</strong>
          <small>5 units or fewer</small>
        </div>

        <div className="product-stat-card">
          <span>Out of Stock</span>
          <strong>{loading ? '—' : outOfStock}</strong>
          <small>Needs replenishment</small>
        </div>
      </div>

      <div className="order-toolbar product-toolbar">
        <input
          type="text"
          placeholder="Search by product name or ID..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />

        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
        >
          <option value="all">All Products</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
        </select>
      </div>

      <div className="orders-section">
        <div className="section-header">
          <div>
            <h2>All Products</h2>
            <p>{loading ? 'Loading...' : `${filteredProducts.length} products found`}</p>
          </div>
        </div>

        <div className="table-container">
          <table>
            <thead>
              <tr>
                <th>PRODUCT</th>
                <th>PRICE</th>
                <th>STOCK</th>
                <th>STATUS</th>
                <th>ACTION</th>
              </tr>
            </thead>

            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={5} style={{ textAlign: 'center', padding: 40 }}>
                    Loading products...
                  </td>
                </tr>
              
              ) : filteredProducts.length > 0 ? (
                filteredProducts.map((product) => {
                  const stock = Number(product.stock ?? 0)
                  const status = product.is_active ? 'active' : 'inactive'

                  return (
                    <tr key={product.id}>
                      <td>
                        <div className="product-name-cell">
                          <div className="product-icon">📦</div>
                          <div>
                            <strong>{product.name}</strong>
                            <small>Product #{product.id}</small>
                          </div>
                        </div>
                      </td>

                      <td>{formatPrice(product.price)}</td>

                      <td>
                        <span
                          className={`stock-indicator ${
                            stock === 0 ? 'out' : stock <= 5 ? 'low' : 'available'
                          }`}
                        >
                          {stock === 0
                            ? 'Out of stock'
                            : stock <= 5
                              ? `Low · ${stock}`
                              : `${stock} units`}
                        </span>
                      </td>

                      <td>
                        <span className={`status ${status}`}>
                          {product.is_active ? 'Active' : 'Inactive'}
                        </span>
                      </td>

                      <td>
  <div className="product-actions">
    <button
      type="button"
      className="view-button"
      onClick={() => setSelectedProduct(product)}
    >
      View
    </button>

    <button
      type="button"
      className="view-button"
      onClick={() => startEditing(product)}
    >
      Edit
    </button>
  </div>
</td>
                    </tr>
                  )
                })
              ) : (
                <tr>
                  <td
                    colSpan={5}
                    style={{
                      textAlign: 'center',
                      padding: 40,
                      color: '#6b7280',
                    }}
                  >
                    No products match your search or filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {selectedProduct && (
        <div
          className="product-modal-overlay"
          onClick={() => setSelectedProduct(null)}
        >
          <div
            className="product-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="product-modal-title"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="product-modal-header">
              <div>
                <p className="order-label">PRODUCT DETAILS</p>
                <h2 id="product-modal-title">{selectedProduct.name}</h2>
                <p>Product #{selectedProduct.id}</p>
              </div>

              <button
                className="product-modal-close"
                onClick={() => setSelectedProduct(null)}
                aria-label="Close product details"
              >
                ×
              </button>
            </div>

            <div className="product-modal-icon">📦</div>

            <div className="detail-row">
              <span>Price</span>
              <strong>{formatPrice(selectedProduct.price)}</strong>
            </div>

            <div className="detail-row">
              <span>Available Stock</span>
              <strong>{selectedProduct.stock ?? 0} units</strong>
            </div>

            <div className="detail-row">
              <span>Status</span>
              <strong>
                {selectedProduct.is_active ? 'Active' : 'Inactive'}
              </strong>
            </div>

            <div className="detail-row">
              <span>Created</span>
              <strong>
                {selectedProduct.created_at
                  ? new Date(selectedProduct.created_at).toLocaleDateString('en-IN')
                  : '—'}
              </strong>
            </div>

            <div className="product-description">
              <strong>Description</strong>
              <p>{selectedProduct.description || 'No description available.'}</p>
            </div>

            <button
              className="product-modal-done"
              onClick={() => setSelectedProduct(null)}
            >
              Close Details
            </button>
          </div>
        </div>
      )}
      
{editingProduct && (
  <div
    className="product-modal-overlay"
    onClick={() => !saving && setEditingProduct(null)}
  >
    <form
      className="product-modal"
      onSubmit={handleSaveProduct}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="product-modal-header">
        <div>
          <p className="order-label">EDIT PRODUCT</p>
          <h2>{editingProduct.name}</h2>
          <p>Product #{editingProduct.id}</p>
        </div>

        <button
          type="button"
          className="product-modal-close"
          onClick={() => setEditingProduct(null)}
          disabled={saving}
        >
          ×
        </button>
      </div>

      <label>
        Product Name
        <input
          required
          value={editingProduct.name}
          onChange={(e) =>
            setEditingProduct({
              ...editingProduct,
              name: e.target.value,
            })
          }
        />
      </label>

      <label>
        Price (₹)
        <input
          required
          type="number"
          min="0"
          step="0.01"
          value={editingProduct.price}
          onChange={(e) =>
            setEditingProduct({
              ...editingProduct,
              price: e.target.value,
            })
          }
        />
      </label>

      <label>
        Stock
        <input
          required
          type="number"
          min="0"
          step="1"
          value={editingProduct.stock}
          onChange={(e) =>
            setEditingProduct({
              ...editingProduct,
              stock: e.target.value,
            })
          }
        />
      </label>

      <label>
        Description
        <textarea
          rows="3"
          value={editingProduct.description}
          onChange={(e) =>
            setEditingProduct({
              ...editingProduct,
              description: e.target.value,
            })
          }
        />
      </label>

      <label>
        Product Status
        <select
          value={editingProduct.is_active ? 'active' : 'inactive'}
          onChange={(e) =>
            setEditingProduct({
              ...editingProduct,
              is_active: e.target.value === 'active',
            })
          }
        >
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
        </select>
      </label>

      {saveError && <p role="alert">{saveError}</p>}

      <div className="product-actions">
        <button
          type="button"
          className="view-button"
          disabled={saving}
          onClick={() => setEditingProduct(null)}
        >
          Cancel
        </button>

        <button
          type="submit"
          className="product-modal-done"
          disabled={saving}
        >
          {saving ? 'Saving...' : 'Save Changes'}
        </button>
      </div>
    </form>
  </div>
)}

    </div>
  )
}

export default Products
