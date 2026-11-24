-- Additive staging migration. No production migration or sale activation implied.
PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS commerce_approved_terms(
 version TEXT NOT NULL, sha256 TEXT NOT NULL CHECK(length(sha256)=64 AND sha256 NOT GLOB '*[^0-9a-f]*'),
 document_text TEXT NOT NULL, approved_at TEXT NOT NULL, PRIMARY KEY(version,sha256)
);
CREATE TABLE IF NOT EXISTS commerce_checkout_sessions(
 session_id TEXT PRIMARY KEY, token_hash TEXT NOT NULL UNIQUE,
 product_id TEXT NOT NULL REFERENCES commerce_products(product_id),
 tier TEXT NOT NULL CHECK(tier IN ('basic','premium','unlimited')),
 price_cents INTEGER NOT NULL CHECK(price_cents IN(2999,5999,9999)),
 buyer_email TEXT NOT NULL, terms_version TEXT NOT NULL, terms_hash TEXT NOT NULL,
 schedule_version TEXT NOT NULL,schedule_hash TEXT NOT NULL, accepted_at TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN('ACCEPTED','CREATING','CREATED','CAPTURING','COMPLETED','HOLD')),
 paypal_order_id TEXT UNIQUE REFERENCES commerce_orders(paypal_order_id), created_at_epoch INTEGER NOT NULL,
 FOREIGN KEY(terms_version,terms_hash) REFERENCES commerce_approved_terms(version,sha256),
 FOREIGN KEY(product_id,schedule_version,schedule_hash) REFERENCES commerce_publishing_schedules(product_id,schedule_version,schedule_sha256)
);
CREATE TABLE IF NOT EXISTS commerce_license_documents(
 license_id TEXT PRIMARY KEY REFERENCES commerce_licenses(license_id),
 document_text TEXT NOT NULL, document_sha256 TEXT NOT NULL CHECK(length(document_sha256)=64),
 schedule_version TEXT NOT NULL,schedule_hash TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS commerce_webhook_inbox(
 event_id TEXT PRIMARY KEY, event_type TEXT NOT NULL, resource_id TEXT,
 received_at TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'RECONCILE_REQUIRED'
);
CREATE TRIGGER IF NOT EXISTS commerce_checkout_acceptance_immutable
BEFORE UPDATE OF product_id,tier,price_cents,buyer_email,terms_version,terms_hash,schedule_version,schedule_hash,accepted_at,token_hash,created_at_epoch ON commerce_checkout_sessions
BEGIN SELECT RAISE(ABORT,'Accepted checkout terms are immutable'); END;
CREATE TRIGGER IF NOT EXISTS commerce_approved_terms_immutable BEFORE UPDATE ON commerce_approved_terms
BEGIN SELECT RAISE(ABORT,'Approved terms are immutable'); END;
CREATE TRIGGER IF NOT EXISTS commerce_license_document_immutable BEFORE UPDATE ON commerce_license_documents
BEGIN SELECT RAISE(ABORT,'Issued document is immutable'); END;
