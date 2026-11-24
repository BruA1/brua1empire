import {buyerGrants,buyerDownload} from "../fulfillment/buyer-delivery.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {DatabaseSync} from "node:sqlite";
import {createCheckoutService,sha256,receiveVerifiedWebhook} from "../fulfillment/production-checkout-service.mjs";
const product="BRUA1-INS-0001",version="BRUA1-LEGAL-APPROVED-TEST",scheduleVersion="FIXTURE-V1",terms="TEST ONLY: terms fixture",schedule="TEST ONLY: agreed publishing fixture",merchant="MERCHANT123",orderId="TESTORDER12345",captureId="CAPTURE12345";
function adapter(sqlite){
 function wrap(sql,args=[]){return {bind(...a){return wrap(sql,a);},first:async()=>sqlite.prepare(sql).get(...args),run:async()=>({meta:{changes:sqlite.prepare(sql).run(...args).changes}}),sql,args};}
 return {prepare:wrap,async batch(items){sqlite.exec("BEGIN");try{const out=items.map(s=>({meta:{changes:sqlite.prepare(s.sql).run(...s.args).changes}}));sqlite.exec("COMMIT");return out;}catch(e){sqlite.exec("ROLLBACK");throw e;}}};
}
async function fixture(){
 const sqlite=new DatabaseSync(":memory:");
 for(const p of ["commerce-schema-staging","publishing-schedules-staging","checkout-ledger-staging"])sqlite.exec(fs.readFileSync("fulfillment/"+p+".sql","utf8"));
 const termsHash=await sha256(terms),scheduleHash=await sha256(schedule);
 sqlite.prepare("INSERT INTO commerce_products(product_id,title,sale_enabled,rights_cleared,independent_qa_pass) VALUES(?,?,1,1,1)").run(product,"Fixture");
 for(const fmt of ["mp3","wav"])sqlite.prepare("INSERT INTO commerce_audio_assets(product_id,format,r2_object_key,private_r2_qa_pass,independent_qa_pass,rights_cleared) VALUES(?,?,?,1,1,1)").run(product,fmt,"fixture/"+fmt);
 sqlite.prepare("INSERT INTO commerce_approved_terms VALUES(?,?,?,?)").run(version,termsHash,terms,"2026-11-23");
 sqlite.prepare("INSERT INTO commerce_publishing_schedules VALUES(?,?,?,?,?)").run(product,scheduleVersion,scheduleHash,schedule,"2026-11-23");
 const env=Object.fromEntries("CHECKOUT_ROUTES_ENABLED LIVE_CHECKOUT_ENABLED LICENSE_ISSUANCE_ENABLED REAL_AUDIO_DELIVERY_ENABLED MERCHANT_IDENTITY_VERIFIED FINAL_TERMS_PUBLISHED OWNER_FINAL_GO_LIVE_SIGNOFF RIGHTS_REVIEW_COMPLETED DELIVERY_INTEGRATION_QA_PASS PRODUCTION_PAYPAL_QA_PASS WEBHOOK_SIGNATURE_QA_PASS REFUND_AND_DISPUTE_QA_PASS BUYER_RECEIPT_SERVICE_QA_PASS PRIVACY_AND_REFUND_POLICY_APPROVED TAX_CONFIGURATION_VERIFIED".split(" ").map(f=>[f,"true"]));
 Object.assign(env,{PAYPAL_ENVIRONMENT:"live",AGREEMENT_STATUS:"LEGAL_APPROVED",APPROVED_TERMS_VERSION:version,APPROVED_TERMS_SHA256:termsHash,TAX_PRICE_MODE:"VERIFIED_FIXED_TOTAL_USD",PAYPAL_CLIENT_ID:"fake",PAYPAL_CLIENT_SECRET:"fake",PAYPAL_WEBHOOK_ID:"fake",PAYPAL_MERCHANT_ID:merchant,ORDERS_DB:adapter(sqlite),BUYER_DELIVERY_ROUTE_VERIFIED:'true',WEBHOOK_RECONCILIATION_VERIFIED:'true',INSTRUMENTAL_MASTERS:{head:async()=>({size:4096}),get:async()=>({size:4096,body:new Response(new Uint8Array(4096)).body})}});
 let captures=0,creates=0;
 const order=status=>({id:orderId,status,links:[{rel:"approve",href:"https://www.paypal.com/checkoutnow?token="+orderId}],purchase_units:[{custom_id:product+":basic:"+version,payee:{merchant_id:merchant},amount:{currency_code:"USD",value:"29.99"},payments:{captures:[{id:captureId,status:"COMPLETED",amount:{currency_code:"USD",value:"29.99"},final_capture:true}]}}]});
 const transport=async(url,opts)=>{
  if(url.endsWith("/token"))return Response.json({access_token:"fake"});
  if(url.endsWith("verify-webhook-signature"))return Response.json({verification_status:"SUCCESS"});
  if(url.endsWith("/orders")&&opts.method==="POST"){creates++;return Response.json(order("CREATED"));}
  if(url.endsWith("/capture")){captures++;return Response.json(order("COMPLETED"));}
  if(url.endsWith(orderId))return Response.json(order(captures?"COMPLETED":"APPROVED"));
  throw Error("Unexpected provider call");
 };
 return {sqlite,env,transport,service:createCheckoutService(env,{transport}),input:{accepted:true,publishingAccepted:true,buyerEmail:"buyer@example.invalid",productId:product,tier:"basic",termsVersion:version,termsHash,scheduleVersion,scheduleHash},counts:()=>({captures,creates})};
}
test("full isolated checkout records exact assent, pays once, issues one immutable license",async()=>{
 const f=await fixture(),{service,sqlite,input}=f;
 await assert.rejects(service.begin({...input,publishingAccepted:false}),/acceptance/);
 await assert.rejects(service.begin({...input,scheduleHash:"0".repeat(64)}),/unavailable/);
 const session=await service.begin({...input,priceCents:1});
 assert.equal(session.amountCents,2999);
 assert.deepEqual(f.counts(),{creates:0,captures:0});
 assert.equal(sqlite.prepare("SELECT status FROM commerce_checkout_sessions").get().status,"ACCEPTED");
 const provider=await service.create(session);
 assert.equal(provider.orderId,orderId);
 await assert.rejects(service.create(session),/already started/);
 const result=await service.capture(session);
 assert.ok(result.licenseDocument.includes(terms)&&result.licenseDocument.includes(schedule));
 const repeat=await service.capture(session);
 assert.equal(repeat.licenseDocument,result.licenseDocument);
 assert.deepEqual(f.counts(),{creates:1,captures:1});
 assert.equal(sqlite.prepare("SELECT count(*) AS n FROM commerce_licenses").get().n,1);
 assert.equal(sqlite.prepare("SELECT count(*) AS n FROM commerce_license_documents").get().n,1);
 assert.throws(()=>sqlite.exec("UPDATE commerce_license_documents SET document_text='tampered'"),/immutable/);
 await assert.rejects(service.capture({...session,sessionToken:"0".repeat(64)}),/Unknown checkout/);
 sqlite.close();
});
test("verified webhook is recorded once and does not grant audio or change payment status",async()=>{
 const f=await fixture();
 const headers=new Headers({"paypal-transmission-id":"x","paypal-transmission-time":"x","paypal-cert-url":"https://example.invalid","paypal-auth-algo":"x","paypal-transmission-sig":"x"});
 const event={id:"EVENT123",event_type:"PAYMENT.CAPTURE.REFUNDED",resource:{id:"REFUND123"}};
 await receiveVerifiedWebhook(f.env,headers,event,f.transport);
 await receiveVerifiedWebhook(f.env,headers,event,f.transport);
 assert.equal(f.sqlite.prepare("SELECT count(*) AS n FROM commerce_webhook_inbox").get().n,1);
 assert.equal(f.sqlite.prepare("SELECT count(*) AS n FROM commerce_download_grants").get().n,0);
 f.sqlite.close();
});

test("buyer session receives only paid format and cannot reset three-use grant",async()=>{
 const f=await fixture(),session=await f.service.begin(f.input);
 await f.service.create(session);
 await assert.rejects(buyerGrants(f.env,session,f.transport),/No validated/);
 await f.service.capture(session);
 await assert.rejects(buyerGrants(f.env,{...session,sessionToken:"0".repeat(64)},f.transport),/No validated/);
 const a=await buyerGrants(f.env,session,f.transport),b=await buyerGrants(f.env,session,f.transport);
 assert.equal(a.grants.length,1);assert.equal(a.grants[0].format,"mp3");assert.equal(a.grants[0].token,b.grants[0].token);
 const request=()=>new Request("https://example.invalid/api/checkout/download",{method:"POST",headers:{Authorization:"Bearer "+a.grants[0].token,Origin:"https://brua1.com"}});
 for(let i=0;i<3;i++){const res=await buyerDownload(f.env,request());assert.equal(res.status,200);assert.equal((await res.arrayBuffer()).byteLength,4096);}
 assert.equal((await buyerDownload(f.env,request())).status,403);
 await assert.rejects(buyerGrants(f.env,session,f.transport),/exhausted/);
 assert.equal(f.sqlite.prepare("SELECT count(*) AS n FROM commerce_download_grants").get().n,1);
 f.sqlite.close();
});
