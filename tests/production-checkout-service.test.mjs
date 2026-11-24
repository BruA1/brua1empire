import test from "node:test";
import assert from "node:assert/strict";
import {productionCheckoutReady,createCheckoutService,sha256,receiveVerifiedWebhook} from "../fulfillment/production-checkout-service.mjs";
test("production routes remain locked on incomplete release settings",()=>{
 assert.equal(productionCheckoutReady({LIVE_CHECKOUT_ENABLED:"true",ORDERS_DB:{}}),false);
 assert.throws(()=>createCheckoutService({LIVE_CHECKOUT_ENABLED:"true"}),/locked/);
});
test("hash matches immutable document bytes",async()=>assert.equal(await sha256("abc"),"ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"));
test("webhook verification failure never touches database",async()=>{
 let writes=0;
 const env={PAYPAL_ENVIRONMENT:"live",PAYPAL_WEBHOOK_ID:"test",PAYPAL_CLIENT_ID:"fake",PAYPAL_CLIENT_SECRET:"fake",ORDERS_DB:{prepare(){writes++;throw Error("unexpected");}}};
 const headers=new Headers({"paypal-transmission-id":"x","paypal-transmission-time":"x","paypal-cert-url":"https://example.invalid","paypal-auth-algo":"x","paypal-transmission-sig":"x"});
 const transport=async(url)=>Response.json(url.endsWith("/token")?{access_token:"fake"}:{verification_status:"FAILURE"});
 await assert.rejects(receiveVerifiedWebhook(env,headers,{id:"EVENT",event_type:"PAYMENT.CAPTURE.COMPLETED"},transport),/could not be verified/);
 assert.equal(writes,0);
});
