# BruA1 PayPal Sandbox checkout — development only

## Current state
- This branch does not change the production Worker or enable checkout.
- `paypal-sandbox-api.js` is an isolated module, not yet imported by the deployed Worker.
- Sandbox credentials are expected as Worker environment bindings: `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, and `PAYPAL_ENVIRONMENT=sandbox`.
- No real transactions, capture, or digital delivery are enabled.
- License prices in the prototype are provisional: Basic $29.99, Premium $59.99, Unlimited $99.99. Exclusive requires manual quotation.

## Before enabling
1. Identify the actual source entry point and Wrangler configuration that currently deploy the static site. Preserve existing static-asset routing.
2. Verify approved catalog track IDs, ownership, playable preview files, license eligibility and finalized terms. Supply a trusted server-side allowlist, not browser-supplied pricing.
3. Implement server-side order-to-track/license records, durable replay/idempotency protections, and verify order amounts, currency, merchant/payee, status and capture details against the stored selection.
4. Implement secure, expiring download links and license receipts, accessible only after verified capture; add refunds/disputes handling.
5. Add CSRF/origin protections, rate limiting and safe error handling, and verify environment bindings and secret handling.
6. Test end-to-end in Sandbox, including invalid requests, duplicate captures, payment denial, fulfillment failure, and mobile checkout.
7. Obtain explicit approval of prices, licensing terms, and live activation before merging to main or switching to live credentials.

## Current endpoint scaffold
`handlePayPal(request, env)` returns null for unrelated routes. The create-order path is gated by a verified catalog environment binding. Capture is deliberately disabled until persistent order reconciliation and fulfillment exist.

**Do not deploy or merge this branch as a complete checkout system.**
