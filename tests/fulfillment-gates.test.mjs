import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {fulfillmentDecision,createLicenseRecord,planStagingReceipt,PRICES} from "../fulfillment/core.mjs";

const data=JSON.parse(readFileSync("catalog/fulfillment-readiness.json","utf8"));
const license=JSON.parse(readFileSync("contracts/instrumental-terms-draft-v2.json","utf8"));
const version="BRUA1-LEGAL-APPROVED-V1";
const hash="a".repeat(64);
function fixture(){
 return {
 order:{paypal_order_id:"9XB31257TP234821E",product_id:"BRUA1-INS-0001",license_tier:"basic",
  amount_cents:2999,currency:"USD",status:"COMPLETED",paypal_capture_id:"CAPTURE123",
  buyer_email:"artist@example.test"},
 product:{product_id:"BRUA1-INS-0001",sale_enabled:true,rights_cleared:true,independent_qa_pass:true},
 verifiedPayment:{verified_by_server:true,status:"COMPLETED",order_id:"9XB31257TP234821E",
  capture_id:"CAPTURE123",currency:"USD",amount_cents:2999,product_id:"BRUA1-INS-0001",tier:"basic"},
 acceptance:{order_id:"9XB31257TP234821E",product_id:"BRUA1-INS-0001",
  tier:"basic",terms_version:version,accepted_at:"2026-11-23T22:00:00Z",
  terms_sha256:hash,affirmative_accepted:true},
 config:{enabled:true,owner_signed_off:true,environment:"production",agreement_status:"LEGAL_APPROVED",
  approved_terms_published:true,merchant_identity_verified:true,approved_terms_version:version,approved_terms_sha256:hash},
 assets:{mp3:{private_key:"private-bucket/track.mp3",independent_qa_pass:true,
    rights_cleared:true,exists_in_private_r2:true,content_type_checked:true},
  wav:{private_key:"private-bucket/track.wav",independent_qa_pass:true,
    rights_cleared:true,exists_in_private_r2:true,content_type_checked:true}}
 };
}
test("39 public tracks mapped, only 36 scope and three owner-held; zero real sales",()=>{
 assert.equal(data.products.length,39);
 assert.equal(new Set(data.products.map(x=>x.product_id)).size,39);
 assert.equal(data.products.filter(x=>x.pilot_batch_candidate).length,36);
 assert.equal(data.products.filter(x=>x.owner_hold).length,3);
 assert.deepEqual(data.products.filter(x=>x.owner_hold).map(x=>x.title).sort(),["Chopin","Laid Back & Litty","paralyzed"].sort());
 assert.equal(data.products.filter(x=>x.private_mp3_manifested).length,38);
 assert.equal(data.products.filter(x=>x.private_wav_manifested).length,36);
 assert.equal(data.products.filter(x=>x.sale_enabled).length,0);
 assert.equal(data.products.filter(x=>x.pilot_batch_candidate).every(x=>x.private_mp3_manifested&&x.private_wav_manifested),true);
});
test("draft licenses and 36 readiness cannot authorize a sale",()=>{
 assert.equal(license.not_live,true);
 assert.equal(license.public_license_issuance_enabled,false);
 for(const row of data.products.filter(x=>x.pilot_batch_candidate)){
   const f=fixture();f.product.product_id=row.product_id;f.order.product_id=row.product_id;f.verifiedPayment.product_id=row.product_id;f.acceptance.product_id=row.product_id;
   f.product.sale_enabled=row.sale_enabled;
   const r=fulfillmentDecision(f);
   assert.equal(r.allowed,false);
   assert.ok(r.blockers.includes("PRODUCT_NOT_CLEARED"));
 }
});
test("fail-closed gates refuse incomplete authorizations",()=>{
 const f=fixture();const overrides=[
  z=>z.config.enabled=false,
  z=>z.config.owner_signed_off=false,
  z=>z.config.environment="sandbox",
  z=>z.config.agreement_status="DRAFT",
  z=>z.config.approved_terms_published=false,
  z=>z.config.merchant_identity_verified=false,
  z=>z.config.approved_terms_version="BRUA1-DRAFT-V2-2026-11-23",
  z=>z.order.status="CREATED",
  z=>z.order.refunded_at="now",
  z=>z.order.amount_cents=1,
  z=>z.order.license_tier="exclusive",
  z=>z.product.sale_enabled=false,
  z=>z.product.independent_qa_pass=false,
  z=>z.verifiedPayment.verified_by_server=false,
  z=>z.verifiedPayment.amount_cents=1,
  z=>z.verifiedPayment.product_id="BRUA1-INS-0039",
  z=>z.acceptance.affirmative_accepted=false,
  z=>z.acceptance.terms_sha256="b".repeat(64),
  z=>z.order.buyer_email="not-an-email",
  z=>z.assets.mp3.exists_in_private_r2=false
 ];
 for(const mutate of overrides){
   const x=structuredClone(f);mutate(x);
   const d=fulfillmentDecision(x);assert.equal(d.allowed,false,mutate.toString());assert.ok(d.blockers.length);
 }
});
test("every tier is priced server-side and requires its particular formats",()=>{
 for(const tier of ["basic","premium","unlimited"]){
  const f=fixture();f.order.license_tier=tier;f.order.amount_cents=PRICES[tier];f.verifiedPayment.tier=tier;f.verifiedPayment.amount_cents=PRICES[tier];f.acceptance.tier=tier;
  const yes=fulfillmentDecision(f);assert.equal(yes.allowed,true,tier);
  if(tier!=="basic"){
    const x=structuredClone(f);x.assets.wav.exists_in_private_r2=false;
    const no=fulfillmentDecision(x);
    assert.equal(no.allowed,false);assert.ok(no.blockers.includes("ASSET_NOT_CLEARED_WAV"));
  }
 }
});
test("licenses cannot be issued under draft; valid audit record includes binding version",()=>{
 const f=fixture();
 assert.throws(()=>createLicenseRecord({order:f.order,acceptedTerms:f.acceptance,issueAt:"2026-11-23T22:00:00Z",licenseId:"LICENSE123",documentHash:hash,config:{...f.config,agreement_status:"DRAFT"}}));
 const yes=createLicenseRecord({order:f.order,acceptedTerms:f.acceptance,issueAt:"2026-11-23T22:00:00Z",licenseId:"LICENSE123",documentHash:hash,config:f.config});
 assert.equal(yes.agreement_version,version);
 assert.deepEqual(yes.permitted_formats,["mp3"]);
 assert.equal(yes.legal_document_delivery_required,true);
});
test("staging receipts are explicitly not licenses and do not provide MP3/WAV",()=>{
 const f=fixture();
 const receipt=planStagingReceipt({order:f.order,product:{product_id:f.order.product_id,title:"108 in the Shade"},requestedTier:"basic"});
 assert.equal(receipt.is_license,false);assert.equal(receipt.real_audio_delivery,false);
 assert.equal(receipt.amount_cents,2999);
 assert.throws(()=>planStagingReceipt({order:f.order,product:{product_id:"BRUA1-INS-0039"},requestedTier:"basic"}));
});
