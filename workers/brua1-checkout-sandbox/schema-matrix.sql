-- BruA1 separate 36 x 3 PayPal SANDBOX order/receipt tables.
-- Append-only. Existing one-track pilot tables remain untouched.
-- The existing Cloudflare D1 is SANDBOX ONLY. No buyer legal license or audio references.
-- Do not run this migration on a production database.
CREATE TABLE IF NOT EXISTS matrix_orders (
  id TEXT PRIMARY KEY,
  paypal_order_id TEXT NOT NULL UNIQUE,
  product_id TEXT NOT NULL,
  product_title TEXT NOT NULL,
  tier TEXT NOT NULL CHECK(tier IN('basic','premium','unlimited')),
  price_cents INTEGER NOT NULL CHECK(price_cents IN(2999,5999,9999)),
  currency TEXT NOT NULL CHECK(currency='USD'),
  status TEXT NOT NULL DEFAULT 'CREATED' CHECK(status IN('CREATED','CAPTURING','COMPLETED','FAILED','REFUNDED')),
  paypal_capture_id TEXT,
  completed_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS matrix_receipt_tokens (
  token_hash TEXT PRIMARY KEY CHECK(length(token_hash)=64),
  order_id TEXT NOT NULL REFERENCES matrix_orders(id),
  expires_at TEXT NOT NULL,
  max_downloads INTEGER NOT NULL DEFAULT 3 CHECK(max_downloads BETWEEN 1 AND 3),
  download_count INTEGER NOT NULL DEFAULT 0 CHECK(download_count BETWEEN 0 AND 3)
);
CREATE INDEX IF NOT EXISTS idx_brua1_matrix_paypal ON matrix_orders(paypal_order_id);
CREATE INDEX IF NOT EXISTS idx_brua1_matrix_token_order ON matrix_receipt_tokens(order_id);
