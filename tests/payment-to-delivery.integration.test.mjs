import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {resolveLicenseSelection,makePayPalOrderRequest,verifyCompletedPayPalOrder,
  assertAcceptance,HELD_PRODUCTS,EXPECTED_PRICE_CENTS} from "../fulfillment/paypal-payment-gates.mjs";
import {fulfillmentDecision,createLicenseRecord} from "../fulfillment/core.mjs";
import {issuePurchaseDownloadGrant,streamLicensedAudio} from "../fulfillment/private-delivery.mjs";

const catalog=JSON.parse(fs.readFileSync("catalog/store-skus-staging.json","utf8"));
const approval={version:"BRUA1-LEGAL-APPROVED-MOCK",sha256:"a".repeat(64),
  legally_reviewed:true,owner_signed_off:true,seller_verified:true,published:true,
  refundable_policy_approved:true};
const productGate={sale_enabled:true,rights_cleared:true,independent_qa_pass:true,private_assets_qa_pass:true};
const operator={enable_real_money:true,production_paypal_verified:true,
  webhook_signature_qa_pass:true,delivery_integration_qa_pass:true,refund_reversal_qa_pass:true};
const merchantId="MOCK_BRUA1_MERCHANT";
const orderId="9XB31257TP234821E";
function makeFixture(productId,tier){
  const selection=resolveLicenseSelection({catalog,productId,tier,mode:"production",approval,
    operator,product:{product_id:productId,...productGate}});
  const payload=makePayPalOrderRequest(selection,"https://checkout.brua1.com/");
  const provider={id:orderId,status:"COMPLETED",purchase_units:[{
    ...payload.purchase_units[0],payee:{merchant_id:merchantId},
    payments:{captures:[{id:"MOCK_CAPTURE_001",status:"COMPLETED",
      amount:payload.purchase_units[0].amount,final_capture:true}]}
  }]};
  const paid=verifyCompletedPayPalOrder({providerOrder:provider,selection,expectedOrderId:orderId,merchantId});
  const accepted={order_id:orderId,product_id:productId,tier,terms_version:approval.version,
    terms_sha256:approval.sha256,accepted_at:"2026-11-23T22:00:00Z",affirmative_accepted:true};
  assert.equal(assertAcceptance({acceptance:accepted,selection,approval,orderId}),true);
  const order={paypal_order_id:orderId,product_id:productId,license_tier:tier,
    amount_cents:selection.priceCents,currency:"USD",status:"COMPLETED",
    paypal_capture_id:paid.capture_id,buyer_email:"artist@example.test"};
  const config={enabled:true,owner_signed_off:true,environment:"production",
    agreement_status:"LEGAL_APPROVED",approved_terms_published:true,
    approved_terms_version:approval.version,approved_terms_sha256:approval.sha256,
    merchant_identity_verified:true,allowed_origin:"https://brua1.com"};
  const product={product_id:productId,sale_enabled:true,rights_cleared:true,independent_qa_pass:true};
  const assets=Object.fromEntries(["mp3","wav"].map(f=>[f,{
    private_key:"private/mock/"+productId+"."+f,exists_in_private_r2:true,
    rights_cleared:true,independent_qa_pass:true,content_type_checked:true
  }]));
  const decision=fulfillmentDecision({order,product,verifiedPayment:{
    verified_by_server:true,status:"COMPLETED",order_id:paid.order_id,capture_id:paid.capture_id,
    currency:paid.currency,amount_cents:paid.amount_cents,product_id:paid.product_id,tier:paid.tier
  },acceptance:accepted,config,assets});
  assert.equal(decision.allowed,true,productId+":"+tier+" "+JSON.stringify(decision.blockers));
  const license=createLicenseRecord({order,acceptedTerms:accepted,config,decision,
    issueAt:"2026-11-23T22:00:30Z",licenseId:"LIC-"+productId+"-"+tier.toUpperCase(),
    documentHash:"b".repeat(64)});
  return {selection,paid,order,config,decision,license,assets};
}

test("All 108 SKUs: verified mocked production capture -> exact accepted license, zero live checkout",()=>{
  for(const sku of catalog.skus){
    const f=makeFixture(sku.product_id,sku.tier);
    assert.equal(f.selection.priceCents,EXPECTED_PRICE_CENTS[sku.tier]);
    assert.equal(f.paid.product_id,sku.product_id);
    assert.equal(f.paid.tier,sku.tier);
    assert.equal(f.license.agreement_version,approval.version);
    assert.deepEqual(f.license.permitted_formats,sku.files);
    assert.equal(sku.checkout_enabled,false);
    assert.equal(sku.fulfillment_enabled,false);
    assert(!HELD_PRODUCTS.includes(sku.product_id));
  }
  assert.equal(catalog.skus.length,108);
});
function mockedD1AndR2(productId,license){
  const grants=new Map(),reads=[];
  const db={
    prepare(sql){
      let vals=[];
      return {bind(...x){vals=x;return this;},
        async first(){
          if(sql.includes("FROM commerce_audio_assets WHERE product_id")){
            if(vals[0]!==productId||!["mp3","wav"].includes(vals[1]))return null;
            return {product_id:productId,format:vals[1],
              r2_object_key:"private/mock/"+productId+"."+vals[1],
              rights_cleared:1,independent_qa_pass:1,private_r2_qa_pass:1};
          }
          if(sql.includes("FROM commerce_download_grants")){
            const g=grants.get(vals[0]);if(!g)return null;
            return {...g,grant_revoked:null,license_status:"ISSUED",agreement_version:approval.version,
              license_product:productId,license_tier:license.tier,order_status:"COMPLETED",
              order_product:productId,refunded_at:null,chargeback_at:null,order_revoked:null,
              sale_enabled:1,r2_object_key:"private/mock/"+productId+"."+g.format,
              rights_cleared:1,independent_qa_pass:1,private_r2_qa_pass:1};
          }
          throw Error("Unexpected query");
        },
        async run(){
          if(sql.startsWith("INSERT INTO commerce_download_grants")){
            const [token_hash,license_id,pid,format,expires_at_epoch]=vals;
            assert.equal(pid,productId);assert.equal(license_id,license.license_id);
            grants.set(token_hash,{token_hash,license_id,product_id:pid,format,expires_at_epoch,
              max_downloads:3,download_count:0});
            return {meta:{changes:1}};
          }
          if(sql.startsWith("UPDATE commerce_download_grants")){
            const g=grants.get(vals[0]);
            if(!g||g.download_count>=g.max_downloads||g.expires_at_epoch<=vals[1])return {meta:{changes:0}};
            g.download_count++;return {meta:{changes:1}};
          }
          throw Error("Unexpected run");
        }
      };
    }
  };
  const r2={async get(key){
    reads.push(key);assert(key.startsWith("private/mock/"+productId+"."));
    const size=2048,bytes=new Uint8Array(size);bytes[0]=73;bytes[1]=68;bytes[2]=51;
    return {size,body:new ReadableStream({start(c){c.enqueue(bytes);c.close();}})};
  }};
  return {env:{ORDERS_DB:db,INSTRUMENTAL_MASTERS:r2},grants,reads};
}
test("Basic -> MP3 only; Premium and Unlimited -> paid MP3 and WAV via time-limited private token",async()=>{
 for(const tier of ["basic","premium","unlimited"]){
  const f=makeFixture("BRUA1-INS-0001",tier);
  const sim=mockedD1AndR2(f.order.product_id,f.license);
  for(const format of f.license.permitted_formats){
    const g=await issuePurchaseDownloadGrant({
      env:sim.env,config:f.config,decision:f.decision,licenseRecord:f.license,order:f.order,format});
    const request=new Request("https://download.example.test/file",{
      method:"POST",headers:{Origin:"https://brua1.com",Authorization:"Bearer "+g.token}});
    const response=await streamLicensedAudio({request,env:sim.env,config:f.config});
    assert.equal(response.status,200);
    assert.equal(response.headers.get("Content-Type"),format==="mp3"?"audio/mpeg":"audio/wav");
    assert.equal((await response.arrayBuffer()).byteLength,2048);
  }
  const expected=tier==="basic"?1:2;
  assert.equal(sim.reads.length,expected);
  if(tier==="basic"){
    await assert.rejects(issuePurchaseDownloadGrant({
      env:sim.env,config:f.config,decision:f.decision,licenseRecord:f.license,order:f.order,format:"wav"}));
  }
 }
});
test("Held tracks blocked at checkout regardless of client-supplied price or tier",()=>{
 for(const id of HELD_PRODUCTS)for(const tier of ["basic","premium","unlimited"]){
  assert.throws(()=>makeFixture(id,tier));
 }
});
