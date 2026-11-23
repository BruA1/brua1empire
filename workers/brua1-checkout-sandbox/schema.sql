-- This schema is for a separate empty SANDBOX D1 database only.
-- If tables already exist, inspect current schema before applying.
-- Never run against production/order data and never set products.active=1.
CREATE TABLE IF NOT EXISTS products (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  license_type TEXT NOT NULL,
  price_cents INTEGER NOT NULL CHECK (price_cents > 0),
  currency TEXT NOT NULL,
  r2_object_key TEXT,
  active INTEGER NOT NULL DEFAULT 0 CHECK (active=0)
);
CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,
  paypal_order_id TEXT NOT NULL UNIQUE,
  product_id TEXT NOT NULL REFERENCES products(id),
  amount_cents INTEGER NOT NULL,
  currency TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('CREATED','CAPTURING','COMPLETED','FAILED','REFUNDED')),
  paypal_capture_id TEXT,
  completed_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS download_tokens (
  token_hash TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES orders(id),
  expires_at TEXT NOT NULL,
  max_downloads INTEGER NOT NULL DEFAULT 3,
  download_count INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_brua1_orders_paypal ON orders(paypal_order_id);
CREATE INDEX IF NOT EXISTS idx_brua1_tokens_order ON download_tokens(order_id);
-- Pilot is flagged inactive; only Worker test-key endpoints may see/use it.
INSERT INTO products (id,title,license_type,price_cents,currency,active)
VALUES ('BRUA1-INS-0001','108 in the Shade','basic',2999,'USD',0)
ON CONFLICT(id) DO UPDATE SET title=excluded.title,license_type=excluded.license_type,price_cents=excluded.price_cents,currency=excluded.currency,active=0;
