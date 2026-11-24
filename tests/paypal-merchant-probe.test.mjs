import test from "node:test";
import assert from "node:assert/strict";
import {verifyLiveMerchant} from "../fulfillment/paypal-merchant-probe.mjs";
import {sha256} from "../fulfillment/production-checkout-service.mjs";
const env={PAYPAL_ENVIRONMENT:"live",LIVE_CHECKOUT_ENABLED:"false",CHECKOUT_ROUTES_ENABLED:"false",REAL_AUDIO_DELIVERY_ENABLED:"false",LICENSE_ISSUANCE_ENABLED:"false",PAYPAL_CLIENT_ID:"fixture",PAYPAL_CLIENT_SECRET:"fixture"};
test("verifies default merchant with no payer approval, authorization or capture",async()=>{
 const merchant="ABCDEF2345678",id="TESTORDER12345";
 let calls=[];
 const transport=async(url,opts)=>{
  calls.push(url);
  if(url.endsWith("/token"))return Response.json({access_token:"fixture"});
  if(url.endsWith("/orders")){const body=JSON.parse(opts.body);assert.equal(body.purchase_units[0].payee,undefined);assert.equal(body.payment_source,undefined);return Response.json({id,status:"CREATED"});}
  if(url.endsWith(id))return Response.json({id,status:"CREATED",purchase_units:[{payee:{merchant_id:merchant},amount:{currency_code:"USD",value:"29.99"}}]});
  throw Error("Unexpected endpoint");
 };
 const expected=await sha256(merchant);
 const result=await verifyLiveMerchant(env,"test",transport,expected);
 assert.equal(result.verified,true);assert.equal(result.paymentCaptured,false);assert.equal(calls.length,3);
 await assert.rejects(verifyLiveMerchant(env,"test",transport,"0".repeat(64)),/mismatch/);
 await assert.rejects(verifyLiveMerchant({...env,LIVE_CHECKOUT_ENABLED:"true"},"test",transport,expected),/Lock/);
});
