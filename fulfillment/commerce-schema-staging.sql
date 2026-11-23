-- BruA1 COMMERCE SCHEMA — REVIEWED STRUCTURE ONLY, NOT APPLIED TO ANY DATABASE.
-- This must be migrated ONLY into a separately authorized production commerce D1.
-- Never run this script against the working PayPal sandbox database.
-- Never activate rows until legal approval, rights verification, QA and CEO launch signoff.
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS commerce_products (
  product_id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  launch_group TEXT NOT NULL DEFAULT 'BATCH_36',
  sale_enabled INTEGER NOT NULL DEFAULT 0 CHECK(sale_enabled IN (0,1)),
  rights_cleared INTEGER NOT NULL DEFAULT 0 CHECK(rights_cleared IN (0,1)),
  independent_qa_pass INTEGER NOT NULL DEFAULT 0 CHECK(independent_qa_pass IN (0,1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS commerce_audio_assets (
  product_id TEXT NOT NULL REFERENCES commerce_products(product_id),
  format TEXT NOT NULL CHECK(format IN ('mp3','wav')),
  r2_object_key TEXT NOT NULL,
  private_r2_qa_pass INTEGER NOT NULL DEFAULT 0 CHECK(private_r2_qa_pass IN(0,1)),
  independent_qa_pass INTEGER NOT NULL DEFAULT 0 CHECK(independent_qa_pass IN(0,1)),
  rights_cleared INTEGER NOT NULL DEFAULT 0 CHECK(rights_cleared IN(0,1)),
  size_bytes INTEGER,
  content_sha256 TEXT,
  PRIMARY KEY(product_id,format)
);
CREATE TABLE IF NOT EXISTS commerce_orders (
  paypal_order_id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES commerce_products(product_id),
  license_tier TEXT NOT NULL CHECK(license_tier IN ('basic','premium','unlimited')),
  amount_cents INTEGER NOT NULL CHECK(amount_cents>0),
  currency TEXT NOT NULL CHECK(currency='USD'),
  buyer_email TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('CREATED','CAPTURING','COMPLETED','FAILED','REFUNDED','DISPUTED')),
  paypal_capture_id TEXT UNIQUE,
  payment_verified_at TEXT,
  refunded_at TEXT,
  chargeback_at TEXT,
  revoked_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS commerce_terms_acceptance (
  paypal_order_id TEXT NOT NULL REFERENCES commerce_orders(paypal_order_id),
  product_id TEXT NOT NULL,
  license_tier TEXT NOT NULL,
  terms_version TEXT NOT NULL,
  terms_sha256 TEXT NOT NULL,
  affirmatively_accepted INTEGER NOT NULL DEFAULT 0 CHECK(affirmatively_accepted IN (0,1)),
  accepted_at TEXT,
  PRIMARY KEY(paypal_order_id,terms_version)
);
CREATE TABLE IF NOT EXISTS commerce_licenses (
  license_id TEXT PRIMARY KEY,
  paypal_order_id TEXT NOT NULL UNIQUE REFERENCES commerce_orders(paypal_order_id),
  product_id TEXT NOT NULL REFERENCES commerce_products(product_id),
  tier TEXT NOT NULL CHECK(tier IN ('basic','premium','unlimited')),
  agreement_version TEXT NOT NULL,
  agreement_sha256 TEXT NOT NULL,
  document_sha256 TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('ISSUED','REVOKED')),
  buyer_email TEXT NOT NULL,
  issued_at TEXT NOT NULL,
  revoked_at TEXT
);
CREATE TABLE IF NOT EXISTS commerce_download_grants (
  token_hash TEXT PRIMARY KEY CHECK(length(token_hash)=64),
  license_id TEXT NOT NULL REFERENCES commerce_licenses(license_id),
  product_id TEXT NOT NULL REFERENCES commerce_products(product_id),
  format TEXT NOT NULL CHECK(format IN ('mp3','wav')),
  expires_at_epoch INTEGER NOT NULL,
  max_downloads INTEGER NOT NULL DEFAULT 3 CHECK(max_downloads BETWEEN 1 AND 3),
  download_count INTEGER NOT NULL DEFAULT 0 CHECK(download_count>=0),
  revoked_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_commerce_download_grants_license ON commerce_download_grants(license_id);
CREATE INDEX IF NOT EXISTS idx_commerce_orders_product ON commerce_orders(product_id);
-- NOTE: no actual product or private object rows inserted.
-- The three held titles never enter the first production sale catalog.
