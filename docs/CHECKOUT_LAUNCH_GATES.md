# BruA1 Checkout & Fulfillment Launch Gates

Development branch only. No live purchases authorized.

1. Confirm licensing terms, prices, formats, and exclusive rights with owner.
2. Configure PayPal sandbox REST application client ID and secret as Worker environment secrets (never in GitHub or browser).
3. Add server-side create-order and capture-order endpoints. Prices and license IDs must be validated against server-owned catalog, not browser-provided totals. Check captured status, amount, currency, payee, and order ID. Persist idempotent order/fulfillment record.
4. Put untagged licensed masters and license PDFs in a PRIVATE R2 bucket. Do not serve masters through public r2.dev or public assets. Map each catalog track and license to a private file and versioned agreement.
5. After verified capture, generate a short-lived signed delivery link or authenticated one-time delivery token with limits; email receipt and fulfillment details. No delivery on client-side approval alone.
6. Test sandbox purchases for each license, payment declines, duplicate callbacks, unauthorized downloads, wrong track, expired links, mobile, refund/cancel behavior.
7. Independent QA PASS and COO/owner authorization required before enabling real checkout or deploying to brua1.com.

Current status: 75 tagged preview URLs configured; sampled playback confirmed by owner; license selector staged but checkout deliberately disabled. No private masters, PayPal secrets, server endpoints, or fulfillment verification configured.
