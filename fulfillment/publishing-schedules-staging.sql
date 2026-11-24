-- Staging extension only. Apply after commerce-schema-staging.sql, on isolated QA D1.
-- No product is activated; no actual buyer data is inserted.
PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS commerce_publishing_schedules (
  product_id TEXT NOT NULL REFERENCES commerce_products(product_id),
  schedule_version TEXT NOT NULL,
  schedule_sha256 TEXT NOT NULL CHECK(length(schedule_sha256)=64 AND schedule_sha256 NOT GLOB '*[^0-9a-f]*'),
  schedule_document TEXT NOT NULL,
  approved_at TEXT NOT NULL,
  PRIMARY KEY(product_id,schedule_version,schedule_sha256)
);
CREATE TABLE IF NOT EXISTS commerce_publishing_acceptance (
  paypal_order_id TEXT PRIMARY KEY REFERENCES commerce_orders(paypal_order_id),
  product_id TEXT NOT NULL,
  schedule_version TEXT NOT NULL,
  schedule_sha256 TEXT NOT NULL,
  accepted_at TEXT NOT NULL,
  FOREIGN KEY(product_id,schedule_version,schedule_sha256)
    REFERENCES commerce_publishing_schedules(product_id,schedule_version,schedule_sha256)
);
CREATE TRIGGER IF NOT EXISTS commerce_publishing_acceptance_product_guard
BEFORE INSERT ON commerce_publishing_acceptance
WHEN NOT EXISTS (SELECT 1 FROM commerce_orders WHERE paypal_order_id=NEW.paypal_order_id AND product_id=NEW.product_id)
BEGIN SELECT RAISE(ABORT,'Publishing acceptance must match order product'); END;
CREATE TRIGGER IF NOT EXISTS commerce_publishing_acceptance_immutable
BEFORE UPDATE ON commerce_publishing_acceptance
BEGIN SELECT RAISE(ABORT,'Accepted publishing record is immutable'); END;
CREATE TRIGGER IF NOT EXISTS commerce_publishing_schedule_immutable
BEFORE UPDATE ON commerce_publishing_schedules
BEGIN SELECT RAISE(ABORT,'Approved publishing schedule is immutable; create a new version'); END;
-- Production integration must check these records BEFORE provider order creation
-- using a pending internal order and AGAIN before capture/issuance/delivery.
-- This extension alone does not enforce prepayment assent or enable sales.
