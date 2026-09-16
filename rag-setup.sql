-- Create a lightweight knowledge base for the RAG assistant
CREATE TABLE IF NOT EXISTS knowledge_base (
  id BIGSERIAL PRIMARY KEY,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  source_type TEXT DEFAULT 'faq',
  category TEXT DEFAULT 'general',
  product_id INT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Optional: helpful indexes for keyword lookup
CREATE INDEX IF NOT EXISTS idx_knowledge_base_title
  ON knowledge_base USING GIN (to_tsvector('english', title));

CREATE INDEX IF NOT EXISTS idx_knowledge_base_content
  ON knowledge_base USING GIN (to_tsvector('english', content));

-- Example rows for a starter knowledge base
INSERT INTO knowledge_base (title, content, source_type, category)
VALUES
  (
    'Return policy',
    'Customers can request a return within 7 days of delivery. Items must be unused and in original packaging. Refunds are processed within 5 to 7 business days after approval.',
    'policy',
    'support'
  ),
  (
    'Shipping information',
    'Standard shipping takes 3 to 5 business days. Express delivery is available for selected products. Orders are shipped after payment confirmation.',
    'policy',
    'support'
  ),
  (
    'Customer care',
    'Customers can contact support through the Customer Care option in this bot. The helpline number is +91 40 2339 3703.',
    'support',
    'customer-service'
  ),
  (
    'Order status',
    'Customers can track their order using the Track Order option in the WhatsApp bot. Once the package is shipped, tracking details are available in the order summary.',
    'support',
    'orders'
  ),
  (
    'Payment methods',
    'We accept UPI, debit cards, credit cards, and net banking for eligible orders. Payment is confirmed only after successful authorization from the bank or payment gateway.',
    'policy',
    'payments'
  ),
  (
    'Cancellation policy',
    'Orders can be cancelled before they are shipped. Once the package has been dispatched, the order cannot be cancelled and must be returned under the return policy.',
    'policy',
    'orders'
  ),
  (
    'Product support',
    'For damaged or missing items, customers should report the issue within 48 hours of delivery with a photo of the product and packaging. Support will review the claim and guide the next steps.',
    'support',
    'product-support'
  ),
  (
    'Warranty information',
    'Covered products come with a standard manufacturer warranty. Warranty claims depend on the product category and applicable terms provided at the time of purchase.',
    'policy',
    'warranty'
  ),
  (
    'Product catalog help',
    'Customers can browse available products by selecting View Products in the main menu. They can then choose a product and add it to the cart for checkout.',
    'guide',
    'shopping'
  ),
  (
    'Delivery timing',
    'Delivery timing depends on the selected shipping method, city, and stock availability. Customers should check the product page or order tracking details for the latest status.',
    'policy',
    'shipping'
  )
ON CONFLICT DO NOTHING;
