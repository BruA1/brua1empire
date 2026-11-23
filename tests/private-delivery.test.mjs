import test from "node:test";
import assert from "node:assert/strict";
import { issuePurchaseDownloadGrant, streamLicensedAudio } from "../fulfillment/private-delivery.mjs";

function makeMock(){
 const grants=new Map(), mutable={reads:0,claims:0},base={
  token_hash:null,product_id:"BRUA1-INS-0001",format:"mp3",
  expires_at_epoch:Math.floor(Date.now()/1000)+900,max_downloads:3,download_count:0,grant_revoked:null,
  license_status:"ISSUED",agreement_version:"BRUA1-LEGAL-APPROVED-V1",
  license_product:"BRUA1-INS-0001",license_tier:"basic",
  order_status:"COMPLETED",order_product:"BRUA1-INS-0001",refunded_at:null,
  chargeback_at:null,order_revoked:null,sale_enabled:1,
  r2_object_key:"private/music/master.mp3",rights_cleared:1,independent_qa_pass:1,private_r2_qa_pass:1
 };
 const db={
  prepare(sql){
   let args=[];
   return {
    bind(...a){args=a;return this;},
    async first(){
     if(sql.includes("FROM commerce_audio_assets WHERE product_id"))return {
       product_id:"BRUA1-INS-0001",format:"mp3",r2_object_key:base.r2_object_key,
       rights_cleared:1,independent_qa_pass:1,private_r2_qa_pass:1
     };
     if(sql.includes("FROM commerce_download_grants")){
       const g=grants.get(args[0]);
       return g?{...base,...g}:null;
     }
     throw Error("Unexpected read");
    },
    async run(){
     if(sql.includes("INSERT INTO commerce_download_grants")){
       const [token_hash,license_id,product_id,format,expires_at_epoch]=args;
       grants.set(token_hash,{token_hash,license_id,product_id,format,expires_at_epoch,max_downloads:3,download_count:0});
       return {meta:{changes:1}};
     }
     if(sql.includes("UPDATE commerce_download_grants")){
       const g=grants.get(args[0]);if(!g||g.download_count>=g.max_downloads||g.expires_at_epoch<=args[1])return {meta:{changes:0}};
       mutable.claims++;g.download_count++;return {meta:{changes:1}};
     }
     throw Error("Unexpected write");
    }
   };
  }
 };
 const r2={async get(key){
   mutable.reads++;
   assert.equal(key,"private/music/master.mp3");
   const bytes=new Uint8Array(2048);bytes[0]=73;bytes[1]=68;bytes[2]=51;
   return {size:bytes.length,body:new ReadableStream({start(controller){controller.enqueue(bytes);controller.close();}})};
 }};
 const config={enabled:true,owner_signed_off:true,environment:"production",agreement_status:"LEGAL_APPROVED",
  approved_terms_published:true,approved_terms_version:"BRUA1-LEGAL-APPROVED-V1",allowed_origin:"https://brua1.com"};
 const order={paypal_order_id:"9XB31257TP234821E",product_id:"BRUA1-INS-0001",license_tier:"basic"};
 const licenseRecord={order_id:order.paypal_order_id,product_id:order.product_id,tier:order.license_tier,
  record_status:"ISSUED_FROM_VERIFIED_ACCEPTANCE",agreement_version:config.approved_terms_version,
  legal_document_delivery_required:true,license_id:"LIC-123"};
 const decision={allowed:true,product_id:order.product_id,tier:order.license_tier};
 const env={ORDERS_DB:db,INSTRUMENTAL_MASTERS:r2};
 return {config,order,licenseRecord,decision,env,grants,base,mutable};
}
const request=(token,method="POST",origin="https://brua1.com")=>
 new Request("https://downloads.example.test/licensed",{method,headers:{"Authorization":"Bearer "+token,"Origin":origin}});
test("downloads disabled unless legally approved, signed off and production",async()=>{
 const s=makeMock();
 for(const mutation of [
  x=>x.config.enabled=false,
  x=>x.config.owner_signed_off=false,
  x=>x.config.agreement_status="DRAFT",
  x=>x.config.environment="sandbox",
  x=>x.config.approved_terms_published=false
 ]){
  const x=makeMock();mutation(x);
  const r=await streamLicensedAudio({request:request("a".repeat(64)),env:x.env,config:x.config});
  assert.equal(r.status,503);
  assert.equal(x.mutable.reads,0);
  await assert.rejects(issuePurchaseDownloadGrant({env:x.env,config:x.config,decision:x.decision,
   licenseRecord:x.licenseRecord,order:x.order,format:"mp3"}));
 }
});
test("only the license-purchased formats are permitted",async()=>{
 const s=makeMock();
 await assert.rejects(issuePurchaseDownloadGrant({...s,format:"wav"}),/Format not included/);
 await assert.rejects(issuePurchaseDownloadGrant({...s,format:"mp3",decision:{allowed:false}}));
 await assert.rejects(issuePurchaseDownloadGrant({...s,format:"mp3",licenseRecord:{...s.licenseRecord,license_id:null}}));
});
test("hash-only token storage; three authorized streamed uses then denied",async()=>{
 const s=makeMock();
 const grant=await issuePurchaseDownloadGrant({...s,format:"mp3"});
 assert.match(grant.token,/^[a-f0-9]{64}$/);
 assert.equal(s.grants.has(grant.token),false);
 assert.equal(s.grants.size,1);
 assert.equal(grant.expires_at_epoch>Math.floor(Date.now()/1000),true);
 for(let i=0;i<3;i++){
  const r=await streamLicensedAudio({request:request(grant.token),env:s.env,config:s.config});
  assert.equal(r.status,200);
  assert.equal(r.headers.get("Content-Type"),"audio/mpeg");
  assert.match(r.headers.get("Content-Disposition"),/BRUA1-INS-0001_Licensed\.mp3/);
  assert.equal(r.headers.get("Cache-Control"),"private, no-store");
  assert.equal((await r.arrayBuffer()).byteLength,2048);
 }
 const denied=await streamLicensedAudio({request:request(grant.token),env:s.env,config:s.config});
 assert.equal(denied.status,403);
 assert.equal(s.mutable.claims,3);
});
test("invalid, expired, revoked, cross-origin or refunded orders cannot download",async()=>{
 const s=makeMock();
 const grant=await issuePurchaseDownloadGrant({...s,format:"mp3"});
 const invalid=await streamLicensedAudio({request:request("not-valid"),env:s.env,config:s.config});
 assert.equal(invalid.status,401);
 const wrongOrigin=await streamLicensedAudio({request:request(grant.token,"POST","https://other.example"),env:s.env,config:s.config});
 assert.equal(wrongOrigin.status,403);
 const wrongMethod=await streamLicensedAudio({request:request(grant.token,"GET"),env:s.env,config:s.config});
 assert.equal(wrongMethod.status,405);
 s.base.refunded_at="2026-11-23T12:00:00Z";
 const refunded=await streamLicensedAudio({request:request(grant.token),env:s.env,config:s.config});
 assert.equal(refunded.status,403);
 s.base.refunded_at=null;
 for(const g of s.grants.values())g.expires_at_epoch=Math.floor(Date.now()/1000)-5;
 const expired=await streamLicensedAudio({request:request(grant.token),env:s.env,config:s.config});
 assert.equal(expired.status,403);
 assert.equal(s.mutable.claims,0);
 assert.equal(s.mutable.reads,0);
});
test("private key is never returned to client; backend alone resolves R2 path",async()=>{
 const s=makeMock();
 const grant=await issuePurchaseDownloadGrant({...s,format:"mp3"});
 assert.equal(JSON.stringify(grant).includes("private/music"),false);
 const r=await streamLicensedAudio({request:request(grant.token),env:s.env,config:s.config});
 assert.equal(r.status,200);
 const body=new Uint8Array(await r.arrayBuffer());
 assert.equal(body.length,2048);
 assert.equal([...r.headers].some(([k,v])=>v.includes("private/music")),false);
});
