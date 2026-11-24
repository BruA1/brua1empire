import test from "node:test";
import assert from "node:assert/strict";
import {checkoutRoute} from "../workers/brua1-checkout-production/checkout-routes.mjs";
const env=Object.fromEntries("CHECKOUT_ROUTES_ENABLED LIVE_CHECKOUT_ENABLED LICENSE_ISSUANCE_ENABLED REAL_AUDIO_DELIVERY_ENABLED MERCHANT_IDENTITY_VERIFIED FINAL_TERMS_PUBLISHED OWNER_FINAL_GO_LIVE_SIGNOFF RIGHTS_REVIEW_COMPLETED DELIVERY_INTEGRATION_QA_PASS PRODUCTION_PAYPAL_QA_PASS WEBHOOK_SIGNATURE_QA_PASS REFUND_AND_DISPUTE_QA_PASS BUYER_RECEIPT_SERVICE_QA_PASS PRIVACY_AND_REFUND_POLICY_APPROVED TAX_CONFIGURATION_VERIFIED BUYER_DELIVERY_ROUTE_VERIFIED WEBHOOK_RECONCILIATION_VERIFIED".split(" ").map(f=>[f,"true"]));
Object.assign(env,{PAYPAL_ENVIRONMENT:"live",AGREEMENT_STATUS:"LEGAL_APPROVED",APPROVED_TERMS_VERSION:"BRUA1-LEGAL-APPROVED-TEST",APPROVED_TERMS_SHA256:"a".repeat(64),TAX_PRICE_MODE:"VERIFIED_FIXED_TOTAL_USD",PAYPAL_CLIENT_ID:"fixture",PAYPAL_CLIENT_SECRET:"fixture",PAYPAL_WEBHOOK_ID:"fixture",PAYPAL_MERCHANT_ID:"fixture",ORDERS_DB:{}});
function req(path,origin="https://brua1.com",data="{}"){return new Request("https://worker.example.invalid"+path,{method:"POST",headers:{"Origin":origin,"Content-Type":"application/json"},body:data});}
test("all checkout routes remain inaccessible without complete release flags",async()=>{
 for(const p of ["/api/checkout/offer","/api/checkout/begin","/api/create-order","/api/capture-order","/api/paypal/webhook"]){
  const r=await checkoutRoute(req(p),{...env,BUYER_DELIVERY_ROUTE_VERIFIED:"false"},{serviceFactory(){throw Error("must not run");}});
  assert.equal(r.status,503);
 }
});
test("route dispatch validates origin, limits bodies, and does not reveal internal errors",async()=>{
 let called=0;
 const deps={serviceFactory(){return {create:async x=>{called++;return {received:x.sessionId};},capture:async()=>{throw Error("PRIVATE_ERROR");}};}};
 assert.equal((await checkoutRoute(req("/api/create-order","https://other.invalid"),env,deps)).status,403);
 assert.equal((await checkoutRoute(req("/api/create-order","https://brua1.com",JSON.stringify({s:"a".repeat(9000)})),env,deps)).status,409);
 assert.equal(called,0);
 const response=await checkoutRoute(req("/api/create-order","https://brua1.com",JSON.stringify({sessionId:"fixture"})),env,deps);
 assert.equal(response.status,200);assert.equal((await response.json()).received,"fixture");
 const fail=await checkoutRoute(req("/api/capture-order"),env,deps);
 assert.equal(fail.status,409);assert.ok(!(await fail.text()).includes("PRIVATE_ERROR"));
});
