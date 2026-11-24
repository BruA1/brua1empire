import test from "node:test";
import assert from "node:assert/strict";
import {provisionWebhook} from "../fulfillment/paypal-webhook-provision.mjs";
const env={PAYPAL_ENVIRONMENT:"live",LIVE_CHECKOUT_ENABLED:"false",CHECKOUT_ROUTES_ENABLED:"false",REAL_AUDIO_DELIVERY_ENABLED:"false",PAYPAL_CLIENT_ID:"fixture",PAYPAL_CLIENT_SECRET:"fixture"};
const webhook={id:"TESTWEBHOOK123",url:"https://brua1-checkout-production.a1productions0527.workers.dev/api/paypal/webhook",event_types:["PAYMENT.CAPTURE.COMPLETED","PAYMENT.CAPTURE.REFUNDED","PAYMENT.CAPTURE.REVERSED","CUSTOMER.DISPUTE.CREATED"].map(name=>({name}))};
test("registers exact webhook and reads it back without accessing payment endpoints",async()=>{
 let created=0;let found=false;
 const transport=async(url,opts)=>{
  if(url.endsWith("/token"))return Response.json({access_token:"fixture"});
  if(url.endsWith("/webhooks")&&opts.method==="POST"){created++;found=true;assert.deepEqual(JSON.parse(opts.body).event_types,webhook.event_types);return Response.json(webhook);}
  if(url.endsWith("/webhooks"))return Response.json({webhooks:found?[webhook]:[]});
  if(url.endsWith(webhook.id))return Response.json(webhook);
  throw Error("Unexpected API");
 };
 assert.equal((await provisionWebhook(env,transport)).verified,true);
 assert.equal((await provisionWebhook(env,transport)).verified,true);
 assert.equal(created,1);
 await assert.rejects(provisionWebhook({...env,LIVE_CHECKOUT_ENABLED:"true"},transport),/lock/);
});
