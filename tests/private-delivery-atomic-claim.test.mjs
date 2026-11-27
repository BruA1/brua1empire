import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {createHash} from "node:crypto";
import {DatabaseSync} from "node:sqlite";
import {streamLicensedAudio} from "../fulfillment/private-delivery.mjs";

const token="a".repeat(64);
const tokenHash=createHash("sha256").update(token).digest("hex");
const version="BRUA1-LEGAL-APPROVED-TEST";
const product="BRUA1-INS-0001";
const config={enabled:true,owner_signed_off:true,environment:"production",
 agreement_status:"LEGAL_APPROVED",approved_terms_published:true,
 approved_terms_version:version,allowed_origin:"https://brua1.com"};

function fixture(changeBeforeRead=null,changeDuringRead=null){
 const db=new DatabaseSync(":memory:");
 db.exec(fs.readFileSync(new URL("../fulfillment/commerce-schema-staging.sql",import.meta.url),"utf8"));
 db.prepare("INSERT INTO commerce_products(product_id,title,sale_enabled,rights_cleared,independent_qa_pass) VALUES(?,?,1,1,1)").run(product,"TEST ONLY");
 db.prepare("INSERT INTO commerce_audio_assets(product_id,format,r2_object_key,private_r2_qa_pass,independent_qa_pass,rights_cleared) VALUES(?,'wav','fixture.wav',1,1,1)").run(product);
 db.prepare("INSERT INTO commerce_orders(paypal_order_id,product_id,license_tier,amount_cents,currency,buyer_email,status) VALUES('TESTORDER123',?,'premium',5999,'USD','test@example.test','COMPLETED')").run(product);
 db.prepare("INSERT INTO commerce_licenses(license_id,paypal_order_id,product_id,tier,agreement_version,agreement_sha256,document_sha256,status,buyer_email,issued_at) VALUES('LIC-TEST','TESTORDER123',?,'premium',?,?,?,'ISSUED','test@example.test','2026-11-27T00:00:00Z')").run(product,version,"b".repeat(64),"c".repeat(64));
 db.prepare("INSERT INTO commerce_download_grants(token_hash,license_id,product_id,format,expires_at_epoch) VALUES(?,'LIC-TEST',?,'wav',?)").run(tokenHash,product,Math.floor(Date.now()/1000)+900);
 if(changeBeforeRead)db.exec(changeBeforeRead);
 // Generated 16-bit PCM silence, not a real instrumental or customer record.
 const wav=Buffer.alloc(44+4096);
 wav.write("RIFF",0);wav.writeUInt32LE(wav.length-8,4);wav.write("WAVEfmt ",8);
 wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);
 wav.writeUInt32LE(8000,24);wav.writeUInt32LE(16000,28);
 wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write("data",36);wav.writeUInt32LE(4096,40);
 let reads=0;
 const env={ORDERS_DB:{prepare(sql){return{bind(...args){return{
  async first(){return db.prepare(sql).get(...args)??null;},
  async run(){return {meta:{changes:Number(db.prepare(sql).run(...args).changes)}};}
 };}};}},INSTRUMENTAL_MASTERS:{async get(key){
  assert.equal(key,"fixture.wav");reads++;
  if(changeDuringRead)db.exec(changeDuringRead);
  return {size:wav.length,body:new ReadableStream({start(c){c.enqueue(new Uint8Array(wav));c.close();}})};
 }}};
 return {db,wav,env,reads:()=>reads,count:()=>db.prepare("SELECT download_count FROM commerce_download_grants").get().download_count,
  request:()=>new Request("https://test.example.test/download",{method:"POST",headers:{Authorization:"Bearer "+token,Origin:"https://brua1.com"}})};
}
test("Real SQLite atomic claim permits valid license and returns exact fixture bytes",async()=>{
 const f=fixture();try{
 const r=await streamLicensedAudio({env:f.env,config,request:f.request()});
 assert.equal(r.status,200);assert.deepEqual(Buffer.from(await r.arrayBuffer()),f.wav);
 assert.equal(f.count(),1);
 }finally{f.db.close();}
});
test("Existing license revocation timestamp blocks access before storage read",async()=>{
 const f=fixture("UPDATE commerce_licenses SET revoked_at='2026-11-27'");
 try{const r=await streamLicensedAudio({env:f.env,config,request:f.request()});
 assert.equal(r.status,403);assert.equal(f.count(),0);assert.equal(f.reads(),0);
 }finally{f.db.close();}
});
for(const [label,change] of [
 ["refund","UPDATE commerce_orders SET status='REFUNDED',refunded_at='2026-11-27'"],
 ["dispute","UPDATE commerce_orders SET status='DISPUTED',chargeback_at='2026-11-27'"],
 ["license revocation","UPDATE commerce_licenses SET status='REVOKED',revoked_at='2026-11-27'"],
 ["license revocation timestamp","UPDATE commerce_licenses SET revoked_at='2026-11-27'"],
 ["asset remapping","UPDATE commerce_audio_assets SET r2_object_key='different.wav'"],
 ["asset rights withdrawal","UPDATE commerce_audio_assets SET rights_cleared=0"],
 ["product rights withdrawal","UPDATE commerce_products SET rights_cleared=0"],
 ["sale disabled","UPDATE commerce_products SET sale_enabled=0"],
 ["grant revocation","UPDATE commerce_download_grants SET revoked_at='2026-11-27'"]
]){
 test("Atomic claim denies "+label+" occurring during storage read",async()=>{
  const f=fixture(null,change);
  try{const r=await streamLicensedAudio({env:f.env,config,request:f.request()});
   assert.equal(r.status,403);assert.equal(f.count(),0);assert.equal(f.reads(),1);
  }finally{f.db.close();}
 });
}
