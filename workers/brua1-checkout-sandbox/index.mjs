import {handleNetworkSandbox,networkTestHtml,networkTestJs} from "./network-test.mjs";
import {matrixHtml,matrixJs,handleMatrixApi} from "./sandbox-matrix.mjs";
// BruA1 PayPal Checkout TEST-ONLY Worker. Never attach private-master R2 here.
// Live payments and real audio downloads are deliberately not implemented.
const PAYPAL_BASE = "https://api-m.sandbox.paypal.com";
const PILOT = Object.freeze({ id: "BRUA1-INS-0001", title: "108 in the Shade", tier: "basic", priceCents: 2999, currency: "USD" });
const AGREEMENT_VERSION = "BRUA1-DRAFT-V2-2026-11-23";
const ORDER_ID = /^[A-Z0-9]{10,30}$/;
const TOKEN = /^[a-f0-9]{64}$/;
const HEADERS = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer", "X-Frame-Options": "DENY" };
const json = (data, status = 200) => Response.json(data, { status, headers: HEADERS });
const hex = bytes => Array.from(bytes, b => b.toString(16).padStart(2, "0")).join("");
const randomToken = () => hex(crypto.getRandomValues(new Uint8Array(32)));
async function sha256(str) { return hex(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(str)))); }
function sameSecret(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || !b) return false;
  const x = new TextEncoder().encode(a), y = new TextEncoder().encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] || 0) ^ (y[i] || 0);
  return diff === 0;
}
const HTML = [
'<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">',
'<title>BruA1 — Test-Only PayPal Checkout</title><style>',
'body{font:16px/1.55 system-ui,sans-serif;background:#10131a;color:#f7f7fa;max-width:650px;margin:35px auto;padding:20px}',
'h1{font-size:28px}p{color:#d0d8e5}label{display:block;margin:14px 0 7px}input{background:#222937;color:white;padding:12px;width:100%;box-sizing:border-box;border:1px solid #64748b;border-radius:6px}',
'button{padding:12px 18px;margin:16px 8px 0 0;background:#edba62;color:#17130f;border:0;border-radius:6px;font-weight:700;cursor:pointer}',
'button[hidden]{display:none}button:disabled{opacity:.45;cursor:not-allowed}.warning{border:1px solid #916529;padding:12px;background:#382a19}',
'pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#1d2532;padding:12px;border-radius:6px;min-height:3em}',
'</style><script defer src="/test.js"></script></head><body>',
'<h1>BruA1 PayPal Checkout Sandbox</h1>',
'<p class="warning"><strong>TEST ONLY — NO REAL MONEY.</strong> Testing one Basic license. No MP3 or WAV file is delivered; only a harmless test receipt. The live BruA1 store remains closed to payments.</p>',
'<p><strong>Instrumental:</strong> 108 in the Shade<br><strong>Basic test license:</strong> $29.99 USD sandbox funds<br><strong>Agreement:</strong> Draft V2, subject to review (not a legally issued license).</p>',
'<label for="key">Private sandbox test key</label><input id="key" type="password" autocomplete="off" placeholder="Enter test key from Cloudflare secret configuration">',
'<label><input style="width:auto" id="accept" type="checkbox"> I understand this is a sandbox test, not a real purchase or license.</label>',
'<button id="create" type="button">Create PayPal Sandbox Order</button>',
'<button id="capture" type="button" hidden>Capture Approved TEST Payment</button>',
'<button id="issue" type="button" hidden>Issue Test Delivery Token</button>',
'<button id="download" type="button" hidden>Download Test Receipt</button>',
'<p id="instruction"></p><pre id="result" aria-live="polite">Ready for sandbox testing.</pre>',
'</body></html>'
].join("");
const JS = [
'"use strict";',
'const el = id => document.getElementById(id);',
'const params = new URLSearchParams(location.search);',
'const orderId = params.get("token");',
'const output = el("result");',
'let token = "";',
'if (orderId) { el("capture").hidden = false; el("instruction").textContent = "Returned from PayPal. Reenter the private test key, then capture the approved TEST payment."; }',
'if (params.has("cancelled")) el("instruction").textContent = "Sandbox purchase cancelled. No payment captured.";',
'async function send(path, payload) {',
'  if (!el("key").value) throw Error("Enter your private sandbox test key first.");',
'  const response = await fetch(path, {method:"POST",headers:{"Content-Type":"application/json","Authorization":"Bearer "+el("key").value},body:JSON.stringify(payload)});',
'  if (!response.ok) { const e = await response.json().catch(()=>({})); throw Error(e.error || "Sandbox request failed: "+response.status); }',
'  return response;',
'}',
'async function action(fn) { output.textContent = "Processing sandbox request..."; try { await fn(); } catch(e) { output.textContent = e.message; } }',
'el("create").onclick = () => action(async () => {',
'  if (!el("accept").checked) throw Error("Confirm the sandbox testing notice first.");',
'  const r = await send("/api/create-order", { productId:"BRUA1-INS-0001", tier:"basic", sandboxAcknowledged:true });',
'  const data = await r.json(); output.textContent = "Opening PayPal SANDBOX approval..."; location.assign(data.approve);',
'});',
'el("capture").onclick = () => action(async () => {',
'  if (!orderId) throw Error("No returned PayPal order.");',
'  const data = await (await send("/api/capture-order", {orderId})).json();',
'  output.textContent = "TEST payment verified: "+data.status+" for "+data.orderId+". No instrumental files have been delivered.";',
'  if (data.verified) el("issue").hidden = false;',
'});',
'el("issue").onclick = () => action(async () => {',
'  const data = await (await send("/api/issue-test-receipt", {orderId})).json();',
'  token = data.token; el("download").hidden = false;',
'  output.textContent = "Test delivery token issued: "+data.expiresInSeconds+"s, "+data.maxDownloads+" uses. No master audio access.";',
'});',
'el("download").onclick = () => action(async () => {',
'  if (!token) throw Error("Issue a test delivery token first.");',
'  const r = await send("/api/download-test-receipt", {token});',
'  const blob = await r.blob(), u = URL.createObjectURL(blob), a = document.createElement("a");',
'  a.href=u; a.download="BruA1-SANDBOX-Receipt.txt"; document.body.appendChild(a); a.click(); a.remove();',
'  setTimeout(()=>URL.revokeObjectURL(u),10000); output.textContent="Downloaded harmless sandbox receipt. No clean MP3/WAV was exposed.";',
'});'
].join("\n");

function htmlResponse() {
  return new Response(HTML, { headers: { ...HEADERS, "Content-Type": "text/html; charset=utf-8",
    "Content-Security-Policy": "default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'" } });
}
async function paypal(env, path, method = "GET", body, idempotencyKey) {
  const auth = await fetch(PAYPAL_BASE + "/v1/oauth2/token", {
    method: "POST",
    headers: { Authorization: "Basic " + btoa(env.PAYPAL_CLIENT_ID + ":" + env.PAYPAL_CLIENT_SECRET),
      "Content-Type": "application/x-www-form-urlencoded" },
    body: "grant_type=client_credentials"
  });
  if (!auth.ok) throw Error("Sandbox provider authorization failed");
  const { access_token } = await auth.json();
  if (typeof access_token !== "string" || !access_token) throw Error("Sandbox provider token unavailable");
  const headers = { Authorization: "Bearer " + access_token, "Content-Type": "application/json",
    Prefer: "return=representation" };
  if (method === "POST") headers["PayPal-Request-Id"] = idempotencyKey || crypto.randomUUID();
  const response = await fetch(PAYPAL_BASE + path, {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw Error("Sandbox provider request failed: " + response.status);
  return data;
}
function verifyPurchaseUnit(order) {
  const u = order?.purchase_units?.[0];
  return order?.purchase_units?.length === 1 && u?.custom_id === PILOT.id + ":basic:" + AGREEMENT_VERSION &&
    u?.amount?.currency_code === PILOT.currency && u?.amount?.value === "29.99";
}
function findCompletedCapture(order) {
  if (!verifyPurchaseUnit(order)) return null;
  const captures = order.purchase_units[0]?.payments?.captures;
  if (!Array.isArray(captures)) return null;
  return captures.find(c => c.id && c.status === "COMPLETED" &&
    c.amount?.currency_code === PILOT.currency && c.amount?.value === "29.99") || null;
}
async function parseBody(request) {
  const length = Number(request.headers.get("content-length") || 0);
  if (length > 4096) return null;
  const raw = await request.text();
  if (raw.length > 4096) return null;
  try { const parsed = JSON.parse(raw); return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null; }
  catch { return null; }
}
async function captureOrder(env, id) {
  const stored = await env.ORDERS_DB.prepare(
    "SELECT id, paypal_order_id, product_id, amount_cents, currency, status, paypal_capture_id FROM orders WHERE paypal_order_id = ?"
  ).bind(id).first();
  if (!stored || stored.product_id !== PILOT.id || stored.currency !== "USD" || Number(stored.amount_cents) !== PILOT.priceCents)
    return json({ error: "Order not registered for this test product" }, 404);
  const details = await paypal(env, "/v2/checkout/orders/" + id);
  if (!verifyPurchaseUnit(details)) return json({ error: "Sandbox order contents failed verification" }, 409);
  const recorded = findCompletedCapture(details);
  if (stored.status === "COMPLETED") {
    // Never trust D1 status alone: cross-check PayPal capture each time.
    if (!recorded || recorded.id !== stored.paypal_capture_id) return json({ error: "Order requires payment reconciliation" }, 409);
    return json({ sandbox: true, verified: true, orderId: id, captureId: recorded.id, status: "COMPLETED", fulfillment: "test-receipt-only", alreadyRecorded: true });
  }
  if (!["CREATED", "CAPTURING"].includes(stored.status)) return json({ error: "Order cannot be captured" }, 409);
  let capture = recorded;
  if (!capture) {
    // Previous uncertainty must be reconciled before another capture attempt.
    if (stored.status === "CAPTURING") return json({ error: "Capture unresolved; review PayPal sandbox before retry" }, 409);
    if (details.status !== "APPROVED") return json({ error: "Sandbox buyer approval required", status: details.status }, 409);
    const claim = await env.ORDERS_DB.prepare(
      "UPDATE orders SET status = 'CAPTURING' WHERE id = ? AND status = 'CREATED'"
    ).bind(stored.id).run();
    if (claim.meta?.changes !== 1) return json({ error: "Capture already being processed" }, 409);
    let captured;
    try {
      captured = await paypal(env, "/v2/checkout/orders/" + id + "/capture", "POST", {}, "brua1-" + id);
    } catch {
      // Keep CAPTURING; GET on a later request can reconcile. No second blind capture.
      return json({ error: "Capture outcome uncertain; retry reconciliation later" }, 502);
    }
    capture = findCompletedCapture(captured);
  }
  if (!capture) return json({ error: "Sandbox capture not verified" }, 409);
  await env.ORDERS_DB.prepare(
    "UPDATE orders SET status = 'COMPLETED', paypal_capture_id = ?, completed_at = CURRENT_TIMESTAMP WHERE id = ? AND status IN ('CREATED','CAPTURING')"
  ).bind(capture.id, stored.id).run();
  return json({ sandbox: true, verified: true, orderId: id, captureId: capture.id,
    status: "COMPLETED", amount: capture.amount, fulfillment: "test-receipt-only" });
}
async function issueReceipt(env, orderId) {
  const stored = await env.ORDERS_DB.prepare(
    "SELECT id, paypal_order_id, product_id, status, paypal_capture_id FROM orders WHERE paypal_order_id = ?"
  ).bind(orderId).first();
  if (!stored || stored.status !== "COMPLETED" || stored.product_id !== PILOT.id || !stored.paypal_capture_id)
    return json({ error: "A verified completed test payment is required" }, 403);
  // Recheck payment with PayPal before issuing even a simulated entitlement.
  const details = await paypal(env, "/v2/checkout/orders/" + orderId);
  const capture = findCompletedCapture(details);
  if (!capture || capture.id !== stored.paypal_capture_id) return json({ error: "Sandbox payment re-verification failed" }, 409);
  const token = randomToken(), token_hash = await sha256(token);
  await env.ORDERS_DB.prepare(
    "INSERT INTO download_tokens (token_hash, order_id, expires_at, max_downloads) VALUES (?, ?, datetime('now', '+15 minutes'), 3)"
  ).bind(token_hash, stored.id).run();
  return json({ sandbox: true, token, expiresInSeconds: 900, maxDownloads: 3, fulfillment: "harmless-test-receipt-only" });
}
async function downloadReceipt(env, token) {
  const hash = await sha256(token);
  const row = await env.ORDERS_DB.prepare(
    "SELECT o.paypal_order_id, o.product_id, o.status FROM download_tokens t JOIN orders o ON o.id = t.order_id WHERE t.token_hash = ? AND t.expires_at > datetime('now') AND t.download_count < t.max_downloads AND o.status = 'COMPLETED'"
  ).bind(hash).first();
  if (!row || row.product_id !== PILOT.id) return json({ error: "Invalid, expired or exhausted token" }, 403);
  const claim = await env.ORDERS_DB.prepare(
    "UPDATE download_tokens SET download_count = download_count + 1 WHERE token_hash = ? AND expires_at > datetime('now') AND download_count < max_downloads"
  ).bind(hash).run();
  if (claim.meta?.changes !== 1) return json({ error: "Download token was exhausted" }, 403);
  // Deliberately generate harmless text; no R2 binding, object key or clean audio ever used.
  const body = "BRUA1 EMPIRE — SANDBOX RECEIPT\nNot a real purchase or music license.\nProduct: " + PILOT.title +
    "\nProduct ID: " + PILOT.id + "\nTier: BASIC\nTEST amount: $29.99 USD\nSandbox order: " + row.paypal_order_id +
    "\nAgreement reference: " + AGREEMENT_VERSION + "\nNo MP3/WAV file was or will be delivered by this sandbox.\n";
  return new Response(body, { headers: { ...HEADERS, "Content-Type": "text/plain; charset=utf-8",
    "Content-Disposition": 'attachment; filename="BruA1-SANDBOX-Receipt.txt"' } });
}
export default {
  async fetch(request, env) {
    const url = new URL(request.url), path = url.pathname;
    if (path === "/health" && request.method === "GET")
      return json({ service: "brua1-checkout-sandbox", mode: "sandbox", livePayments: false, realAudioDelivery: false });
    if (path === "/network-test" && request.method === "GET") return networkTestHtml();
    if (path === "/network-test.js" && request.method === "GET") return networkTestJs();
    if (path === "/test" && request.method === "GET") return htmlResponse();
    if (path === "/matrix" && request.method === "GET") return matrixHtml();
    if (path === "/matrix.js" && request.method === "GET") return matrixJs();
    if (path === "/test.js" && request.method === "GET")
      return new Response(JS, { headers: { ...HEADERS, "Content-Type": "text/javascript; charset=utf-8" } });
    if (!path.startsWith("/api/")) return json({ error: "Not found" }, 404);
    if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
    if (env.PAYPAL_ENVIRONMENT !== "sandbox" || !env.PAYPAL_CLIENT_ID || !env.PAYPAL_CLIENT_SECRET ||
      !env.CHECKOUT_TEST_KEY || !env.ORDERS_DB)
      return json({ error: "Sandbox environment not configured" }, 503);
    // Browser calls must originate from this exact sandbox Worker origin. No CORS.
    if (request.headers.get("Origin") !== url.origin) return json({ error: "Invalid origin" }, 403);
    if (!sameSecret(request.headers.get("Authorization"), "Bearer " + env.CHECKOUT_TEST_KEY))
      return json({ error: "Unauthorized test access" }, 401);
    const data = await parseBody(request);
    if (!data) return json({ error: "Invalid request body" }, 400);
    try {
      if (path.startsWith("/api/network-test/")) return await handleNetworkSandbox({env,path,data,origin:url.origin,paypal:(p,m,b,k)=>paypal(env,p,m,b,k)});
      if (path.startsWith("/api/matrix/")) return await handleMatrixApi({env,path,data,origin:url.origin});
      if (path === "/api/create-order") {
        if (data.productId !== PILOT.id || data.tier !== PILOT.tier || data.sandboxAcknowledged !== true)
          return json({ error: "Unsupported sandbox product or missing test acknowledgement" }, 400);
        const p = await env.ORDERS_DB.prepare(
          "SELECT id,title,price_cents,currency,license_type FROM products WHERE id = ?"
        ).bind(PILOT.id).first();
        if (!p || p.title !== PILOT.title || Number(p.price_cents) !== PILOT.priceCents ||
          p.currency !== "USD" || p.license_type !== "basic")
          return json({ error: "Sandbox catalog setup incomplete" }, 503);
        const order = await paypal(env, "/v2/checkout/orders", "POST", {
          intent: "CAPTURE",
          purchase_units: [{
            custom_id: PILOT.id + ":basic:" + AGREEMENT_VERSION,
            description: "BruA1 Basic Instrumental License — SANDBOX TEST ONLY",
            amount: { currency_code: "USD", value: "29.99" }
          }],
          payment_source: { paypal: { experience_context: {
            brand_name: "BruA1 Empire — Sandbox",
            user_action: "PAY_NOW",
            return_url: url.origin + "/test",
            cancel_url: url.origin + "/test?cancelled=1"
          }}}
        });
        const approve = order.links?.find(l => l.rel === "payer-action" || l.rel === "approve")?.href;
        let parsed;
        try { parsed = new URL(approve); } catch { /* fail closed */ }
        if (!parsed || parsed.protocol !== "https:" || parsed.hostname !== "www.sandbox.paypal.com")
          return json({ error: "Sandbox approval address unavailable" }, 502);
        // If D1 fails, never provide the PayPal approval link to the buyer.
        await env.ORDERS_DB.prepare(
          "INSERT INTO orders (id, paypal_order_id, product_id, amount_cents, currency, status) VALUES (?, ?, ?, ?, ?, 'CREATED')"
        ).bind(crypto.randomUUID(), order.id, PILOT.id, PILOT.priceCents, PILOT.currency).run();
        return json({ sandbox: true, orderId: order.id, approve, amount: "29.99", currency: "USD" });
      }
      if (path === "/api/capture-order") {
        if (!ORDER_ID.test(data.orderId || "")) return json({ error: "Invalid order ID" }, 400);
        return await captureOrder(env, data.orderId);
      }
      if (path === "/api/issue-test-receipt") {
        if (!ORDER_ID.test(data.orderId || "")) return json({ error: "Invalid order ID" }, 400);
        return await issueReceipt(env, data.orderId);
      }
      if (path === "/api/download-test-receipt") {
        if (!TOKEN.test(data.token || "")) return json({ error: "Invalid receipt token" }, 400);
        return await downloadReceipt(env, data.token);
      }
      return json({ error: "Not found" }, 404);
    } catch {
      // No PayPal credentials, internal paths, stack traces or private object keys in responses.
      return json({ error: "Sandbox request failed safely; inspect restricted Worker logs" }, 502);
    }
  }
};
