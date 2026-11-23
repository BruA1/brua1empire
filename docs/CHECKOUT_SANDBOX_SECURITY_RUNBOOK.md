# BruA1 PayPal Checkout Sandbox — Deployment & Security Runbook
Updated: 2026-11-23 | Owner: BruA1 | Status: TEST-ONLY / NOT LIVE

## Scope
- Isolated Cloudflare Worker named brua1-checkout-sandbox (workers.dev only).
- PayPal API host hard-coded to **api-m.sandbox.paypal.com** (TEST money, not live).
- Single controlled test product BRUA1-INS-0001, “108 in the Shade,” Basic tier, **$29.99 USD TEST**.
- Cloudflare D1 order persistence, exact product/price/currency verification, duplicate-capture protection.
- Receipt token is 32 random bytes; only a SHA-256 digest is persisted in D1. Lifetime 15 minutes, three uses maximum.
- Download returns a harmless **text test receipt**. **No R2 binding and no MP3/WAV master delivery**.
- No code updates to live instrumentals.html; no cart or purchase button on brua1.com; no physical-merch purchase.

## Deployable source and configuration
- workers/brua1-checkout-sandbox/index.mjs — isolated Worker and same-origin test UI.
- workers/brua1-checkout-sandbox/wrangler.toml — only sandbox D1 binding, no R2 or production domain route.
- workers/brua1-checkout-sandbox/schema.sql — optional schema for an EMPTY separate SANDBOX D1 database. Inspect existing schema before applying; existing database may already contain tables and orders.
- tests/checkout-sandbox.test.mjs — isolated mocked PayPal/D1 tests; CI is mandatory before deployment.
- GitHub Actions checkout-sandbox-qa.yml — security checks.

## Cloudflare secret checklist (owner/Cloudflare admin only)
In the **separate sandbox Worker**:
- PAYPAL_ENVIRONMENT=sandbox is a non-secret var set in Wrangler.
- PAYPAL_CLIENT_ID must come from a PayPal developer **sandbox** REST application.
- PAYPAL_CLIENT_SECRET must come from the SAME PayPal sandbox app; do not put in repository, Google Docs, chat, client-side HTML, public endpoints or GitHub Actions logs.
- CHECKOUT_TEST_KEY must be an owner-controlled high-entropy random secret (at least 32 random bytes). The owner enters this in /test; the Worker verifies it server-side and never returns it.
- Cloudflare deployment requires GitHub environment checkout-sandbox and CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID secrets in GitHub Actions. Human approval gates, where configured, must be honored.
- Protect /test further with Cloudflare Access or trusted tester restrictions if desired. Do not use a production PayPal account or credentials.

## D1 before test
1. Verify that brua1-orders-sandbox (7e9532d6-857d-4ecf-ac4b-6de92424fcc3) is a sandbox-only database; confirm it is not used for real transactions.
2. Verify products, orders, and download_tokens tables and their needed columns. DO NOT overwrite or delete existing records. If this is an empty sandbox DB, initialize from schema.sql.
3. Verify inactive test product BRUA1-INS-0001, title 108 in the Shade, tier basic, price_cents 2999, currency USD exists. Its active value must remain 0.
4. No master R2 bucket is bound to this Worker; there is nothing to leak via its receipt API.
5. Never auto-migrate a real database or mark all 39 products active just to pass tests.

## Test sequence
1. CI must pass all mock PayPal/D1 tests with a valid JavaScript syntax check and no R2 or live PayPal API reference.
2. Deploy the sandbox Worker only via an authorized environment deployment; record the exact deployment URL from the output (do not guess the workers.dev subdomain).
3. Open the sandbox Worker /health: look for mode=sandbox, livePayments=false, realAudioDelivery=false.
4. Open /test, enter the owner-controlled CHECKOUT_TEST_KEY, and acknowledge sandbox mode.
5. Create test order for $29.99; ensure the approval URL host is www.sandbox.paypal.com. Log in using a **PayPal sandbox buyer** test account.
6. After PayPal redirects back to /test?token=..., **reenter the key** (for security it is not stored across redirects) and click “Capture Approved TEST Payment.”
7. Confirm COMPLETED with correct product ID/price/currency, database record, and one and only one PayPal capture. Click capture again; it must return alreadyRecorded=true.
8. Issue test receipt token, download the .txt file (never MP3/WAV); repeat three times, fourth must fail with 403. Invalid/expired tokens must fail.
9. Negative tests: invalid key=401, different Origin=403, no config=503, altered product/tier rejected, wrong amount blocked, unknown PayPal ID rejected, canceled/failed/uncertain capture cannot be double-charged, no public merchant order can be made through the regular storefront.
10. Save anonymized screenshots/logs for the release checklist, never passwords, tokens or full buyer data.

## Gate to REAL sales (still CLOSED)
Before any real-money checkout or music delivery:
- Finalize versioned Basic/Premium/Unlimited agreements with specialist legal review; verify legal seller, copyright/sample rights and publishing splits.
- Verify correct private MP3/WAV per product and tier. WAV is not available for every title; do not promise a format that doesn't exist.
- Implement separate production credentials, merchant account, tax/refund/privacy notices, email delivery, webhook verification, refund/chargeback/reversal handling, R2 signed delivery entitlements, download expiry, inventory/merch/shipping logic and independent security QA.
- Bind private audio only in the future approved production fulfillment service. Never reuse the sandbox test key or sandbox PayPal credentials in production.
- Exclusive rights remain manual negotiated and signed, never an auto-checkout product.
- Owner approval and a separately documented successful live/sandbox transition gate are required. NO live production deployment through this branch.

## Existing legacy branch
feature/paypal-sandbox-checkout and PR #1 contain older 38-track-era drafts and a delivery candidate with private R2 audio bindings. Those drafts should NOT be deployed or merged into the 39-track live storefront. This secure branch supersedes them for checkout testing.
