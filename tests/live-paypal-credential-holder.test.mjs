import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import worker from "../workers/brua1-checkout-production/index.mjs";
const origin="https://brua1-checkout-production.example.workers.dev";
const mockSecrets={
  PAYPAL_CLIENT_ID:"SENSITIVE_TEST_CLIENT_ID",
  PAYPAL_CLIENT_SECRET:"SENSITIVE_TEST_CLIENT_SECRET",
  LIVE_CHECKOUT_ENABLED:"true",
  PAYPAL_ENVIRONMENT:"live",
};
test("PRELAUNCH lock always reports no live payments even if flags are overridden",async()=>{
  const r=await worker.fetch(new Request(origin+"/health"),mockSecrets);
  assert.equal(r.status,200);
  const j=await r.json();
  assert.equal(j.livePayments,false);
  assert.equal(j.paymentCaptureEnabled,false);
  assert.equal(j.licenseIssuanceEnabled,false);
  assert.equal(j.realAudioDeliveryEnabled,false);
  assert.equal(j.status,"PRELAUNCH_LOCKED");
});
test("no live API endpoint can create, capture, refund or issue licenses",async()=>{
 for(const path of ["/api/create-order","/api/capture-order","/api/refund","/api/checkout",
 "/api/issue-license","/api/checkout/create-order","/checkout/return"]){
   const r=await worker.fetch(new Request(origin+path,{method:"POST",body:"{}"}),mockSecrets);
   assert.equal(r.status,503,path);
   const body=await r.text();
   assert(!body.includes("SENSITIVE_TEST"));
 }
});
test("health never reveals private credential status or values",async()=>{
 const r=await worker.fetch(new Request(origin+"/health"),mockSecrets);
 const t=await r.text();
 assert(!/SENSITIVE_TEST|secret|client_id|merchant_id/i.test(t));
 assert.equal(r.headers.get("Cache-Control"),"no-store");
 assert.equal(r.headers.get("X-Content-Type-Options"),"nosniff");
});
test("configuration cannot bind D1, R2 or production domain / enable payment",()=>{
 const s=fs.readFileSync("workers/brua1-checkout-production/wrangler.toml","utf8");
 assert.match(s,/LIVE_CHECKOUT_ENABLED = "false"/);
 assert.match(s,/LICENSE_ISSUANCE_ENABLED = "false"/);
 assert.match(s,/REAL_AUDIO_DELIVERY_ENABLED = "false"/);
 assert.match(s,/PAYPAL_ENVIRONMENT = "live"/);
 assert(!/^\[\[(d1_databases|r2_buckets)\]\]/m.test(s));
 assert(!/^route\s*=/m.test(s));
 assert(!/^PAYPAL_CLIENT_(ID|SECRET)\s*=/m.test(s));
});
