import test from "node:test";
import assert from "node:assert/strict";
import {productionPayPalClient} from "../fulfillment/production-paypal-client.mjs";
const env={PAYPAL_ENVIRONMENT:"live",LIVE_CHECKOUT_ENABLED:"true",LICENSE_ISSUANCE_ENABLED:"true",REAL_AUDIO_DELIVERY_ENABLED:"true",MERCHANT_IDENTITY_VERIFIED:"true",PAYPAL_CLIENT_ID:"fake",PAYPAL_CLIENT_SECRET:"fake",PAYPAL_MERCHANT_ID:"MERCHANT123"};
const s={productId:"BRUA1-INS-0001",tier:"basic",priceCents:2999,currency:"USD",sku:"BRUA1-INS-0001-BASIC",termsVersion:"BRUA1-LEGAL-APPROVED-TEST",customId:"BRUA1-INS-0001:basic:BRUA1-LEGAL-APPROVED-TEST",paypalEnvironment:"production",fulfillment:"APPROVED_LICENSE_REQUIRED"};
const id="TESTORDER12345";
const order=(status="APPROVED",merchant=env.PAYPAL_MERCHANT_ID)=>({id,status,links:[{rel:"approve",href:"https://www.paypal.com/checkoutnow?token="+id}],purchase_units:[{custom_id:s.customId,payee:{merchant_id:merchant},amount:{currency_code:"USD",value:"29.99"},payments:{captures:[{id:"CAPTURE12345",status:"COMPLETED",amount:{currency_code:"USD",value:"29.99"},final_capture:true}]}}]});
test("locked settings deny production client without any network",()=>{assert.throws(()=>productionPayPalClient({...env,LIVE_CHECKOUT_ENABLED:"false"},()=>{throw Error("network forbidden")}),/not authorized/);});
test("create requires acceptance and sends stable key and server price",async()=>{
 let calls=0;
 const client=productionPayPalClient(env,async(url,opts)=>{calls++;if(url.endsWith("/token"))return Response.json({access_token:"mock"});assert.equal(opts.headers["PayPal-Request-Id"],"test-create-1");assert.equal(JSON.parse(opts.body).purchase_units[0].amount.value,"29.99");return Response.json(order("CREATED"));});
 await assert.rejects(client.create(s,"test-create-1",false),/acceptance/);
 assert.equal(calls,0);
 assert.equal((await client.create(s,"test-create-1",true)).orderId,id);
});
test("capture rechecks provider state and rejects wrong merchant",async()=>{
 let captures=0;
 const client=productionPayPalClient(env,async(url,opts)=>{if(url.endsWith("/token"))return Response.json({access_token:"mock"});if(url.endsWith("/capture")){captures++;return Response.json(order("COMPLETED"));}return Response.json(order(captures?"COMPLETED":"APPROVED"));});
 await assert.rejects(client.capture(id,s,"test-capture",false),/claim/);
 assert.equal((await client.capture(id,s,"test-capture",true)).capture_id,"CAPTURE12345");
 assert.equal((await client.capture(id,s,"test-capture",true)).capture_id,"CAPTURE12345");
 assert.equal(captures,1);
 const wrong=productionPayPalClient(env,async(url)=>Response.json(url.endsWith("/token")?{access_token:"mock"}:order("COMPLETED","WRONG123456")));
 await assert.rejects(wrong.reconcile(id,s),/does not match/);
});
