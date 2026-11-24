import test from "node:test";
import assert from "node:assert/strict";
import worker from "../workers/brua1-licensed-delivery/index.mjs";
import {authorizePaidDownload,productionDeliveryEnabled} from "../fulfillment/secure-issuance.mjs";

const base="https://brua1-licensed-delivery-stage.example.workers.dev";
const orderId="9XB31257TP234821E",productId="BRUA1-INS-0001";
const terms="BRUA1-LEGAL-APPROVED-TEST",hash="a".repeat(64);
function setup(tier="premium"){
 const price={basic:2999,premium:5999,unlimited:9999}[tier];
 const formatKeys={mp3:"private/108/untagged.mp3",wav:"private/108/master.wav"};
 const o={paypal_order_id:orderId,product_id:productId,license_tier:tier,
   amount_cents:price,currency:"USD",buyer_email:"customer@example.test",
   status:"COMPLETED",paypal_capture_id:"CAPTURE123",refunded_at:null,chargeback_at:null,revoked_at:null};
 const p={product_id:productId,title:"108 in the Shade",sale_enabled:1,rights_cleared:1,independent_qa_pass:1};
 const a={paypal_order_id:orderId,product_id:productId,license_tier:tier,
  terms_version:terms,terms_sha256:hash,affirmatively_accepted:1,accepted_at:"2026-11-23T20:00:00Z"};
 const l={license_id:"LIC-TEST-1",paypal_order_id:orderId,product_id:productId,tier,
   agreement_version:terms,agreement_sha256:hash,document_sha256:"b".repeat(64),
   status:"ISSUED",buyer_email:o.buyer_email,issued_at:"2026-11-23T20:05:00Z",revoked_at:null};
 const asset=fmt=>({product_id:productId,format:fmt,r2_object_key:formatKeys[fmt],
  rights_cleared:1,independent_qa_pass:1,private_r2_qa_pass:1});
 const grants=new Map(),activity={head:0,get:0,paypal:0,writes:0,oauth:0};
 const db={prepare(sql){
  let args=[];
  return {bind(...x){args=x;return this;},
   async first(){
    if(sql.includes("FROM commerce_orders WHERE paypal_order_id"))return o.paypal_order_id===args[0]?o:null;
    if(sql.includes("FROM commerce_products WHERE product_id"))return p.product_id===args[0]?p:null;
    if(sql.includes("FROM commerce_terms_acceptance"))return a.paypal_order_id===args[0]&&a.terms_version===args[1]?a:null;
    if(sql.includes("FROM commerce_licenses WHERE paypal_order_id"))return l.paypal_order_id===args[0]?l:null;
    if(sql.includes("FROM commerce_audio_assets WHERE product_id"))return args[0]===productId&&formatKeys[args[1]]?asset(args[1]):null;
    if(sql.includes("FROM commerce_download_grants")){
     const g=grants.get(args[0]);return g?{
      ...g,grant_revoked:null,license_status:l.status,agreement_version:l.agreement_version,
      license_product:l.product_id,license_tier:l.tier,order_status:o.status,
      order_product:o.product_id,refunded_at:o.refunded_at,chargeback_at:o.chargeback_at,
      order_revoked:o.revoked_at,sale_enabled:p.sale_enabled,r2_object_key:formatKeys[g.format],
      rights_cleared:1,independent_qa_pass:1,private_r2_qa_pass:1
     }:null;
    }
    throw Error("Unknown SELECT: "+sql);
   },
   async run(){
    if(sql.startsWith("INSERT INTO commerce_download_grants")){
     activity.writes++;
     const [token_hash,license_id,id,format,expires_at_epoch]=args;
     assert.equal(license_id,l.license_id);assert.equal(id,productId);
     grants.set(token_hash,{token_hash,product_id:id,format,expires_at_epoch,max_downloads:3,download_count:0});
     return {meta:{changes:1}};
    }
    if(sql.startsWith("UPDATE commerce_download_grants SET download_count")){
     const g=grants.get(args[0]);
     if(!g||g.download_count>=g.max_downloads||g.expires_at_epoch<=args[1])return {meta:{changes:0}};
     g.download_count++;return {meta:{changes:1}};
    }
    throw Error("Unknown UPDATE/INSERT: "+sql);
   }
  };
 }};
 const r2={
   async head(key){activity.head++;assert(Object.values(formatKeys).includes(key));return {size:8192};},
   async get(key){activity.get++;assert(Object.values(formatKeys).includes(key));
    const isWav=key.endsWith(".wav"),b=new Uint8Array(8192);
    if(isWav){b.set([82,73,70,70],0);b.set([87,65,86,69],8);}
    else b.set([73,68,51],0);
    return {size:b.byteLength,body:new ReadableStream({start(ctrl){ctrl.enqueue(b);ctrl.close();}})};
   }
 };
 const provider={id:orderId,status:"COMPLETED",purchase_units:[{
  custom_id:productId+":"+tier+":"+terms,
  amount:{currency_code:"USD",value:(price/100).toFixed(2)},
  payee:{merchant_id:"MERCHANT-TEST"},payments:{captures:[{
   id:"CAPTURE123",status:"COMPLETED",amount:{currency_code:"USD",value:(price/100).toFixed(2)},
   final_capture:true}]}
 }]};
 const transport=async(url)=>{
  activity.paypal++;
  if(url.endsWith("/v1/oauth2/token")){activity.oauth++;return Response.json({access_token:"FAKE"});}
  if(url.endsWith("/v2/checkout/orders/"+orderId))return Response.json(provider);
  throw Error("Unexpected API: "+url);
 };
 const flags={LIVE_DELIVERY_ENABLED:"true",OWNER_FINAL_GO_LIVE_SIGNOFF:"true",PAYPAL_ENVIRONMENT:"production",
  AGREEMENT_STATUS:"LEGAL_APPROVED",FINAL_TERMS_PUBLISHED:"true",APPROVED_TERMS_VERSION:terms,
  APPROVED_TERMS_SHA256:hash,MERCHANT_IDENTITY_VERIFIED:"true",
  PRODUCTION_PAYPAL_QA_PASS:"true",DELIVERY_INTEGRATION_QA_PASS:"true",
  REFUND_AND_DISPUTE_QA_PASS:"true",RIGHTS_REVIEW_COMPLETED:"true",
  BUYER_RECEIPT_SERVICE_QA_PASS:"true",PRIVACY_AND_REFUND_POLICY_APPROVED:"true",
  PAYPAL_CLIENT_ID:"TEST",PAYPAL_CLIENT_SECRET:"TEST",PAYPAL_MERCHANT_ID:"MERCHANT-TEST",
  INTERNAL_FULFILLMENT_KEY:"secret-for-server-only",ALLOWED_ORIGIN:"https://brua1.com",
  ORDERS_DB:db,INSTRUMENTAL_MASTERS:r2
 };
 return {env:flags,db,o,p,a,l,provider,transport,grants,activity};
}
const serviceRequest=(body,key="secret-for-server-only",origin)=>
 new Request(base+"/api/grants",{method:"POST",headers:{"X-BruA1-Service-Key":key,
  "Content-Type":"application/json",...(origin?{"Origin":origin}:{})},body:JSON.stringify(body)});
const buyerRequest=(raw,origin="https://brua1.com")=>
 new Request(base+"/api/download",{method:"POST",headers:{"Authorization":"Bearer "+raw,"Origin":origin}});
test("default staging Worker is inoperable and does not touch PayPal/R2/D1",async()=>{
 const s=setup();
 const blocked={...s.env,PAYPAL_ENVIRONMENT:"sandbox",LIVE_DELIVERY_ENABLED:"false",
   ORDERS_DB:undefined,INSTRUMENTAL_MASTERS:undefined};
 const health=await worker.fetch(new Request(base+"/health"),blocked);
 assert.equal(health.status,200);assert.equal((await health.json()).deliveryEnabled,false);
 const grant=await worker.fetch(serviceRequest({orderId,format:"mp3"}),blocked);
 assert.equal(grant.status,503);
 const dl=await worker.fetch(buyerRequest("a".repeat(64)),blocked);
 assert.equal(dl.status,503);
 assert.equal(s.activity.paypal,0);assert.equal(s.activity.head,0);assert.equal(s.activity.get,0);
});
test("every final launch flag and required binding is a hard gate",()=>{
 const s=setup();assert.equal(productionDeliveryEnabled(s.env),true);
 for(const [key,value] of Object.entries({
  LIVE_DELIVERY_ENABLED:"false",OWNER_FINAL_GO_LIVE_SIGNOFF:"false",
  PAYPAL_ENVIRONMENT:"sandbox",AGREEMENT_STATUS:"DRAFT",FINAL_TERMS_PUBLISHED:"false",
  MERCHANT_IDENTITY_VERIFIED:"false",PRODUCTION_PAYPAL_QA_PASS:"false",
  DELIVERY_INTEGRATION_QA_PASS:"false",REFUND_AND_DISPUTE_QA_PASS:"false",
  RIGHTS_REVIEW_COMPLETED:"false",BUYER_RECEIPT_SERVICE_QA_PASS:"false",
  PRIVACY_AND_REFUND_POLICY_APPROVED:"false",APPROVED_TERMS_SHA256:"invalid",
  ORDERS_DB:null,INSTRUMENTAL_MASTERS:null,PAYPAL_CLIENT_SECRET:null,
  PAYPAL_MERCHANT_ID:null,INTERNAL_FULFILLMENT_KEY:null})){
   assert.equal(productionDeliveryEnabled({...s.env,[key]:value}),false,key);
 }
});
test("untrusted user cannot issue grant; wrong secret and browser origin are denied",async()=>{
 const s=setup();
 const bad=await worker.fetch(serviceRequest({orderId,format:"mp3"},"wrong"),s.env);
 assert.equal(bad.status,401);
 const browser=await worker.fetch(serviceRequest({orderId,format:"mp3"},"secret-for-server-only","https://brua1.com"),s.env);
 assert.equal(browser.status,403);
 assert.equal(s.activity.paypal,0);assert.equal(s.activity.head,0);
});
test("verified Premium order -> approved license -> private MP3 and WAV tokens -> buyer download",async()=>{
 const s=setup("premium");
 for(const format of ["mp3","wav"]){
   const grant=await authorizePaidDownload({env:s.env,orderId,format,transport:s.transport});
   assert.equal(grant.format,format);assert.match(grant.token,/^[a-f0-9]{64}$/);
   assert.equal(s.grants.has(grant.token),false,"Raw token must not be persisted");
   assert.equal(JSON.stringify(grant).includes("private/108"),false,"Private object key must never be leaked");
   for(let attempt=1;attempt<=3;attempt++){
     const response=await worker.fetch(buyerRequest(grant.token),s.env);
     assert.equal(response.status,200);
     assert.equal(response.headers.get("Access-Control-Allow-Origin"),"https://brua1.com");
     assert.equal(response.headers.get("Content-Type"),format==="mp3"?"audio/mpeg":"audio/wav");
     assert.equal((await response.arrayBuffer()).byteLength,8192);
   }
   const exhausted=await worker.fetch(buyerRequest(grant.token),s.env);
   assert.equal(exhausted.status,403);
 }
 assert.equal(s.activity.get,8,"Three valid downloads plus an exhausted 4th R2 read per format");
 assert.equal(s.activity.writes,2);
 assert.equal(s.activity.oauth,2);
});
test("Basic only permits MP3; WAV request cannot issue any token",async()=>{
 const s=setup("basic");
 const ok=await authorizePaidDownload({env:s.env,orderId,format:"mp3",transport:s.transport});
 assert.equal(ok.tier,"basic");
 await assert.rejects(authorizePaidDownload({env:s.env,orderId,format:"wav",transport:s.transport}),/Paid entitlement unavailable/);
 assert.equal(s.activity.writes,1);
});
test("refunded and withdrawn rights fail before remote PayPal or R2",async()=>{
 const s=setup();
 s.o.refunded_at="2026-11-23T21:00:00Z";
 await assert.rejects(authorizePaidDownload({env:s.env,orderId,format:"mp3",transport:s.transport}));
 assert.equal(s.activity.paypal,0);assert.equal(s.activity.head,0);
 s.o.refunded_at=null;s.p.rights_cleared=0;
 await assert.rejects(authorizePaidDownload({env:s.env,orderId,format:"mp3",transport:s.transport}));
 assert.equal(s.activity.paypal,0);
});
test("PayPal tampering, merchant mismatch or capture mismatch denies issuance",async()=>{
 const s=setup();
 s.provider.purchase_units[0].amount.value="1.00";
 await assert.rejects(authorizePaidDownload({env:s.env,orderId,format:"mp3",transport:s.transport}));
 assert.equal(s.activity.writes,0);
 s.provider.purchase_units[0].amount.value="59.99";
 s.provider.purchase_units[0].payee.merchant_id="OTHER";
 await assert.rejects(authorizePaidDownload({env:s.env,orderId,format:"mp3",transport:s.transport}));
 s.provider.purchase_units[0].payee.merchant_id="MERCHANT-TEST";
 s.provider.purchase_units[0].payments.captures[0].id="CAPTURE-WRONG";
 await assert.rejects(authorizePaidDownload({env:s.env,orderId,format:"mp3",transport:s.transport}));
 assert.equal(s.activity.writes,0);
});
test("held product, unsigned license and terms mismatch block sale",async()=>{
 const s=setup();
 s.o.product_id="BRUA1-INS-0004";
 await assert.rejects(authorizePaidDownload({env:s.env,orderId,format:"mp3",transport:s.transport}));
 s.o.product_id=productId;s.l.status="REVOKED";
 await assert.rejects(authorizePaidDownload({env:s.env,orderId,format:"mp3",transport:s.transport}));
 s.l.status="ISSUED";s.a.terms_sha256="c".repeat(64);
 await assert.rejects(authorizePaidDownload({env:s.env,orderId,format:"mp3",transport:s.transport}));
 assert.equal(s.activity.writes,0);
});
test("download requests reject offsite origin, bad token, and wrong method",async()=>{
 const s=setup();
 const offsite=await worker.fetch(buyerRequest("a".repeat(64),"https://attacker.example"),s.env);
 assert.equal(offsite.status,403);
 const bad=await worker.fetch(buyerRequest("invalid-token"),s.env);
 assert.equal(bad.status,401);
 const get=await worker.fetch(new Request(base+"/api/download"),s.env);
 assert.equal(get.status,405);
});
