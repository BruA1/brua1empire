const BASE = "https://api-m.sandbox.paypal.com";
const PRICE = "29.99";
const ITEM = "BruA1 Basic Instrumental License";
const PRODUCT_ID = "BRUA1-INS-0001";
// Sandbox-only private download token: never put the raw token in D1.
const tokenHash = async (token) => {
  const bytes = new TextEncoder().encode(token);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, "0")).join("");
};
const newToken = () => {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes, b => b.toString(16).padStart(2, "0")).join("");
};
const reply = (data, status = 200) =>
Response.json(data, {
status,
headers: { "Cache-Control": "no-store" }
});
async function paypal(env, path, method = "GET", body, requestId) {
const credentials = btoa(
env.PAYPAL_CLIENT_ID + ":" +
env.PAYPAL_CLIENT_SECRET
);
const auth = await fetch(BASE + "/v1/oauth2/token", {
method: "POST",
headers: {
Authorization: "Basic " + credentials,
"Content-Type": "application/x-www-form-urlencoded"
},
body: "grant_type=client_credentials"
});
if (!auth.ok) throw Error("PayPal authentication failed");
const { access_token } = await auth.json();
const response = await fetch(BASE + path, {
method,
headers: {
Authorization: "Bearer " + access_token,
"Content-Type": "application/json",
Prefer: "return=representation",
"PayPal-Request-Id": requestId || crypto.randomUUID()
},
body: body ? JSON.stringify(body) : undefined
});
const data = await response.json().catch(() => ({}));
if (!response.ok) {
throw Error("PayPal request failed: " + response.status);
}
return data;
}
const page = `<!doctype html>
<html lang="en">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>BruA1 Sandbox Checkout</title>
<style>
body{font-family:Arial,sans-serif;background:#111;color:white;
max-width:500px;margin:50px auto;padding:20px}
button,input{padding:14px;margin:8px 0;width:100%;
box-sizing:border-box}
button{background:#17a568;color:white;border:0;
font-weight:bold;cursor:pointer}
input{background:#222;color:white;border:1px solid #777}
pre{white-space:pre-wrap;overflow-wrap:anywhere}
</style>
<h2>BruA1 Sandbox Checkout</h2>
<p>Basic Instrumental License — $29.99 TEST USD</p>
<p>No real money. No instrumental delivery.</p>
<input id="key" type="password" placeholder="Private test key">
<button id="create">Create Test Order</button>
<button id="capture" hidden>Capture Approved Payment</button>
<pre id="result"></pre>
<script>
const result = document.getElementById("result");
const key = document.getElementById("key");
const params = new URLSearchParams(location.search);
const orderId = params.get("token");
if (orderId) {
document.getElementById("capture").hidden = false;
result.textContent = "Order returned from PayPal. Enter your key and capture.";
}
async function send(path, payload) {
result.textContent = "Processing...";
try {
const r = await fetch(path, {
method: "POST",
headers: {
"Content-Type": "application/json",
Authorization: "Bearer " + key.value
},
body: JSON.stringify(payload)
});
const data = await r.json();
if (!r.ok) throw Error(data.error || "Request failed");
return data;
} catch (e) {
result.textContent = e.message;
return null;
}
}
document.getElementById("create").onclick = async () => {
const data = await send("/api/create-order", {});
if (data && data.approve) location.href = data.approve;
};
document.getElementById("capture").onclick = async () => {
const data = await send("/api/capture-order", { orderId });
if (data) result.textContent = JSON.stringify(data, null, 2);
};
</script>
</html>`;
export default {
async fetch(request, env) {
const url = new URL(request.url);
const path = url.pathname;
if (path === "/health") {
return reply({
service: "BruA1 sandbox checkout",
mode: "sandbox",
checkout: "test-only"
});
}
if (path === "/test" && request.method === "GET") {
return new Response(page, {
headers: {
"Content-Type": "text/html; charset=utf-8",
"Cache-Control": "no-store",
"Content-Security-Policy":
"default-src 'none'; script-src 'unsafe-inline'; " +
"style-src 'unsafe-inline'; connect-src 'self'; " +
"form-action 'none'; base-uri 'none'; " +
"frame-ancestors 'none'; referrer 'no-referrer'"
}
});
}
if (!path.startsWith("/api/")) {
return reply({ error: "Not found" }, 404);
}
if (request.method !== "POST") {
return reply({ error: "Method not allowed" }, 405);
}
if (env.PAYPAL_ENVIRONMENT !== "sandbox" ||
!env.PAYPAL_CLIENT_ID ||
!env.PAYPAL_CLIENT_SECRET ||
!env.CHECKOUT_TEST_KEY || !env.ORDERS_DB) {
return reply({ error: "Sandbox configuration invalid" }, 503);
}
const origin = request.headers.get("Origin");
if (origin !== url.origin) {
return reply({ error: "Invalid origin" }, 403);
}
const authorization = request.headers.get("Authorization");
if (authorization !== "Bearer " + env.CHECKOUT_TEST_KEY) {
return reply({ error: "Unauthorized" }, 401);
}
try {
if (path === "/api/issue-download") {
  // Test-key protected, not a public fulfillment endpoint.
  if (!env.INSTRUMENTAL_MASTERS) return reply({ error: "R2 binding missing" }, 503);
  const body = await request.json().catch(() => ({}));
  const orderId = body.orderId;
  if (typeof orderId !== "string" || !/^[A-Z0-9]{10,30}$/.test(orderId))
    return reply({ error: "Invalid order ID" }, 400);
  const order = await env.ORDERS_DB.prepare(
    "SELECT id, product_id, status FROM orders WHERE paypal_order_id = ?"
  ).bind(orderId).first();
  if (!order || order.status !== "COMPLETED" || order.product_id !== PRODUCT_ID)
    return reply({ error: "Verified completed order required" }, 403);
  const product = await env.ORDERS_DB.prepare(
    "SELECT r2_object_key FROM products WHERE id = ? AND license_type = 'basic' AND price_cents = 2999"
  ).bind(PRODUCT_ID).first();
  if (!product?.r2_object_key)
    return reply({ error: "Product delivery configuration missing" }, 503);
  const obj = await env.INSTRUMENTAL_MASTERS.head(product.r2_object_key);
  if (!obj) return reply({ error: "Master MP3 not found" }, 503);
  const token = newToken();
  const hash = await tokenHash(token);
  await env.ORDERS_DB.prepare(
    "INSERT INTO download_tokens (token_hash, order_id, expires_at, max_downloads) VALUES (?, ?, datetime('now', '+15 minutes'), 3)"
  ).bind(hash, order.id).run();
  return reply({ sandbox: true, token, expiresInSeconds: 900, maxDownloads: 3,
    method: "POST", path: "/api/download", fulfillment: "test-only" });
}
if (path === "/api/download") {
  // This endpoint uses the temporary token, not the long-lived test key.
  // It is still sandbox-only and has no public checkout integration.
  if (!env.INSTRUMENTAL_MASTERS) return reply({ error: "R2 binding missing" }, 503);
  const body = await request.json().catch(() => ({}));
  const token = body.token;
  if (typeof token !== "string" || !/^[a-f0-9]{64}$/.test(token))
    return reply({ error: "Invalid download token" }, 401);
  const hash = await tokenHash(token);
  const entry = await env.ORDERS_DB.prepare(
    "SELECT t.order_id, p.r2_object_key FROM download_tokens t JOIN orders o ON o.id = t.order_id JOIN products p ON p.id = o.product_id WHERE t.token_hash = ? AND t.expires_at > datetime('now') AND t.download_count < t.max_downloads AND o.status = 'COMPLETED' AND o.product_id = ?"
  ).bind(hash, PRODUCT_ID).first();
  if (!entry) return reply({ error: "Expired, invalid, or exhausted token" }, 403);
  // Verify the object exists before consuming a download allowance.
  const object = await env.INSTRUMENTAL_MASTERS.get(entry.r2_object_key);
  if (!object) return reply({ error: "Master MP3 unavailable" }, 503);
  const claimed = await env.ORDERS_DB.prepare(
    "UPDATE download_tokens SET download_count = download_count + 1 WHERE token_hash = ? AND expires_at > datetime('now') AND download_count < max_downloads"
  ).bind(hash).run();
  if (claimed.meta?.changes !== 1)
    return reply({ error: "Download limit reached" }, 403);
  return new Response(object.body, { headers: {
    "Content-Type": "audio/mpeg",
    "Content-Disposition": 'attachment; filename="BruA1 - 108 in the Shade - Untagged.mp3"',
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer"
  } });
}
if (path === "/api/create-order") {
const product = await env.ORDERS_DB.prepare(
  "SELECT id, title, price_cents, currency, license_type FROM products WHERE id = ?"
).bind(PRODUCT_ID).first();
if (!product || product.price_cents !== 2999 || product.currency !== "USD" ||
    product.license_type !== "basic") {
  return reply({ error: "Sandbox product configuration invalid" }, 503);
}
// The product stays inactive for public sales. Only the private sandbox test
// endpoint may create a test order with the CHECKOUT_TEST_KEY.
const order = await paypal(
env, "/v2/checkout/orders", "POST", {
intent: "CAPTURE",
purchase_units: [{
custom_id: PRODUCT_ID,
description: ITEM,
amount: {
currency_code: "USD",
value: PRICE
}
}],
application_context: {
brand_name: "BruA1",
user_action: "PAY_NOW",
return_url: url.origin + "/test",
cancel_url: url.origin + "/test?cancelled=1"
}
}
);
const approve = order.links?.find(
link => link.rel === "approve" ||
link.rel === "payer-action"
)?.href;
if (!approve || !approve.startsWith(
"https://www.sandbox.paypal.com/"
)) {
throw Error("Sandbox approval link unavailable");
}
await env.ORDERS_DB.prepare(
  "INSERT INTO orders (id, paypal_order_id, product_id, amount_cents, currency, status) VALUES (?, ?, ?, ?, ?, 'CREATED')"
).bind(crypto.randomUUID(), order.id, PRODUCT_ID, 2999, "USD").run();
return reply({ orderId: order.id, approve });
}
if (path === "/api/capture-order") {
const body = await request.json();
const id = body.orderId;
if (typeof id !== "string" ||
!/^[A-Z0-9]{10,30}$/.test(id)) {
return reply({ error: "Invalid order ID" }, 400);
}
const stored = await env.ORDERS_DB.prepare(
  "SELECT id, product_id, amount_cents, currency, status, paypal_capture_id FROM orders WHERE paypal_order_id = ?"
).bind(id).first();
if (!stored || stored.product_id !== PRODUCT_ID ||
    stored.amount_cents !== 2999 || stored.currency !== "USD") {
  return reply({ error: "Order not registered in sandbox database" }, 404);
}
// A persisted completion is idempotent: never capture it again.
if (stored.status === "COMPLETED") {
  return reply({ sandbox: true, verified: true, orderId: id,
    captureId: stored.paypal_capture_id, status: "COMPLETED",
    fulfillment: "disabled", alreadyRecorded: true });
}
if (stored.status !== "CREATED" && stored.status !== "CAPTURING") {
  return reply({ error: "Order is not eligible for capture" }, 409);
}
const order = await paypal(env, "/v2/checkout/orders/" + id);
const unit = order.purchase_units?.[0];
if (order.purchase_units?.length !== 1 ||
    unit?.custom_id !== PRODUCT_ID ||
    unit?.amount?.currency_code !== "USD" ||
    unit?.amount?.value !== PRICE) {
  return reply({ error: "Order failed verification" }, 409);
}
let capture = unit?.payments?.captures?.find(c =>
  c.status === "COMPLETED" && c.amount?.currency_code === "USD" &&
  c.amount?.value === PRICE
);
// If PayPal captured but D1 failed to record it, reconcile instead of charging again.
if (!capture) {
  if (order.status !== "APPROVED") {
    return reply({ error: "Order not approved or capture unresolved", status: order.status }, 409);
  }
  if (stored.status === "CREATED") {
    const claimed = await env.ORDERS_DB.prepare(
      "UPDATE orders SET status = 'CAPTURING' WHERE id = ? AND status = 'CREATED'"
    ).bind(stored.id).run();
    if (claimed.meta?.changes !== 1) {
      return reply({ error: "Capture already in progress; retry shortly" }, 409);
    }
  } else {
    // A previous capture attempt may still be running. Do not race it.
    return reply({ error: "Capture pending reconciliation; retry later or review PayPal" }, 409);
  }
  // Stable idempotency key for this order, including network retries.
  const captureRequestId = "brua1-" + id;
  let captured;
  try {
    captured = await paypal(env, "/v2/checkout/orders/" + id + "/capture",
      "POST", {}, captureRequestId);
  } catch (e) {
    // Deliberately leave CAPTURING; never issue a second capture blindly.
    return reply({ error: "Capture result uncertain; check PayPal before retrying" }, 502);
  }
  capture = captured.purchase_units?.[0]?.payments?.captures?.find(c =>
    c.status === "COMPLETED" && c.amount?.currency_code === "USD" &&
    c.amount?.value === PRICE
  );
}
if (!capture?.id) {
  return reply({ error: "Capture not verified; manual reconciliation required" }, 409);
}
await env.ORDERS_DB.prepare(
  "UPDATE orders SET status = 'COMPLETED', paypal_capture_id = ?, completed_at = CURRENT_TIMESTAMP WHERE id = ? AND status IN ('CREATED', 'CAPTURING')"
).bind(capture.id, stored.id).run();
return reply({ sandbox: true, verified: true, orderId: id,
  captureId: capture.id, status: "COMPLETED", amount: capture.amount,
  fulfillment: "disabled" });
}
return reply({ error: "Not found" }, 404);
} catch (e) {
return reply({
error: "Sandbox operation failed",
detail: e.message
}, 502);
}
}
};
