-- Additive only. Review and apply separately before any discount activation.
CREATE TABLE IF NOT EXISTS commerce_member_checkout_quotes(
 session_id TEXT PRIMARY KEY REFERENCES commerce_checkout_sessions(session_id),
 product_id TEXT NOT NULL,tier TEXT NOT NULL CHECK(tier IN ('basic','premium','unlimited')),
 regular_cents INTEGER NOT NULL,discount_bps INTEGER NOT NULL CHECK(discount_bps=1500),
 subtotal_cents INTEGER NOT NULL,discount_cents INTEGER NOT NULL,tax_cents INTEGER NOT NULL CHECK(tax_cents=0),
 currency TEXT NOT NULL CHECK(currency='USD'),pricing_version TEXT NOT NULL CHECK(pricing_version='BRUA1-MEMBER-15-V1'),
 checked_at_epoch INTEGER NOT NULL,member_session_hash TEXT NOT NULL CHECK(length(member_session_hash)=64),
 CHECK((tier='basic' AND regular_cents=2999 AND subtotal_cents=2549) OR (tier='premium' AND regular_cents=5999 AND subtotal_cents=5099) OR (tier='unlimited' AND regular_cents=9999 AND subtotal_cents=8499)),
 CHECK(discount_cents=regular_cents-subtotal_cents)
);
CREATE TRIGGER IF NOT EXISTS commerce_member_quote_immutable_update BEFORE UPDATE ON commerce_member_checkout_quotes BEGIN SELECT RAISE(ABORT,'Member quote immutable'); END;
CREATE TRIGGER IF NOT EXISTS commerce_member_quote_immutable_delete BEFORE DELETE ON commerce_member_checkout_quotes BEGIN SELECT RAISE(ABORT,'Member quote immutable'); END;
