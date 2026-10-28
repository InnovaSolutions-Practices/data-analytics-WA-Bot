import CustomerDetails from './pages/CustomerDetails'
import OrderDetails from './pages/OrderDetails'
import {
  BrowserRouter,
  Routes,
  Route,
  NavLink,
  useLocation,
  useNavigate,
} from 'react-router-dom'
import Dashboard from './pages/Dashboard'
import Customers from './pages/Customers'
import Orders from './pages/Orders'
import Tracking from './pages/Tracking'
import Carts from './pages/Carts'
import Conversations from './pages/Conversations'
import Products from './pages/Products'
import CartDetails from './pages/CartDetails'
import EditCustomer from './pages/EditCustomer'
import './App.css'

function AppLayout() {
  const location = useLocation()
  const navigate = useNavigate()

  const pageTitles = {
    '/': 'Overview',
    '/customers': 'Customers',
    '/orders': 'Orders',
    '/carts': 'Carts',
    '/conversations': 'Conversations',
    '/products': 'Products',
    '/tracking': 'Tracking',
  }

  const pageTitle =
    pageTitles[location.pathname] ||
    (location.pathname.startsWith('/customers/')
      ? 'Customer Details'
      : location.pathname.startsWith('/orders/')
      ? 'Order Details'
      : location.pathname.startsWith('/carts/')
      ? 'Cart Details'
      : 'Customer Care')
      const breadcrumbMap = {
  '/': 'Overview',
  '/customers': 'Customers',
  '/orders': 'Orders',
  '/carts': 'Carts',
  '/conversations': 'Conversations',
  '/products': 'Products',
  '/tracking': 'Tracking',
}

const currentPage =
  breadcrumbMap[location.pathname] ||
  (location.pathname.startsWith('/customers/')
    ? 'Customer Details'
    : location.pathname.startsWith('/orders/')
    ? 'Order Details'
    : location.pathname.startsWith('/carts/')
    ? 'Cart Details'
    : 'Page')

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="logo">
          <h2>Customer Care</h2>
          <p>Support Dashboard</p>
        </div>

        <nav>
          <NavLink to="/" end>Dashboard</NavLink>
          <NavLink to="/customers">Customers</NavLink>
          <NavLink to="/orders">Orders</NavLink>
          <NavLink to="/carts">Carts</NavLink>
          <NavLink to="/conversations">Conversations</NavLink>
          <NavLink to="/products">Products</NavLink>
          <NavLink to="/tracking">Tracking</NavLink>
        </nav>
      </aside>

      <main className="main-content">
<header className="header">
  <div className="breadcrumb">
  <span>Workspace</span>
  <span className="breadcrumb-separator">/</span>

  {location.pathname.startsWith('/customers/') ? (
    <>
      <span
        className="breadcrumb-link"
        onClick={() => navigate('/customers')}
      >
        Customers
      </span>
      <span className="breadcrumb-separator">/</span>
      <span className="breadcrumb-current">Customer Details</span>
    </>
  ) : location.pathname.startsWith('/orders/') ? (
    <>
      <span
        className="breadcrumb-link"
        onClick={() => navigate('/orders')}
      >
        Orders
      </span>
      <span className="breadcrumb-separator">/</span>
      <span className="breadcrumb-current">Order Details</span>
    </>
  ) : location.pathname.startsWith('/carts/') ? (
    <>
      <span
        className="breadcrumb-link"
        onClick={() => navigate('/carts')}
      >
        Carts
      </span>
      <span className="breadcrumb-separator">/</span>
      <span className="breadcrumb-current">Cart Details</span>
    </>
  ) : (
    <span className="breadcrumb-current">{currentPage}</span>
  )}
</div>

  <div className="header-actions">
    <button
      className="new-customer-btn"
      onClick={() => navigate('/customers?add=true')}
    >
      + New Customer
    </button>

    <div className="admin">
      <div className="admin-avatar">A</div>
      <span>Admin</span>
    </div>
  </div>
</header>

        <section className="dashboard">
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/customers" element={<Customers />} />
            <Route
  path="/customers/:customerId"
  element={<CustomerDetails />}
/>            <Route path="/orders" element={<Orders />} />
            <Route path="/orders/:id" element={<OrderDetails />} />
            <Route path="/carts" element={<Carts />} />
            <Route path="/carts/:id" element={<CartDetails />} />
            <Route path="/conversations" element={<Conversations />} />
            <Route path="/products" element={<Products />} />
            <Route
  path="/customers/:customerId/edit"
  element={<EditCustomer />}
/>
            <Route path="/tracking" element={<Tracking />} />
          </Routes>
        </section>
      </main>
    </div>
  )
}

function App() {
  return (
    <BrowserRouter>
      <AppLayout />
    </BrowserRouter>
  )
}

export default App