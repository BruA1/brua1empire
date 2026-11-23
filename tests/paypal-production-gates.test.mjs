import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  HELD_PRODUCTS,EXPECTED_PRICE_CENTS,verify36SkuMatrix,resolveLicenseSelection,
  makePayPalOrderRequest,validatePayPalApprovalLink,verifyCompletedPayPalOrder,
  assertAcceptance,verifyPayPalWebhook,eventAction
} from "../fulfillment/paypal-payment-gates.mjs";

const catalog=JSON.parse(fs.readFileSync("catalog/store-skus-staging.json","utf8"));
const approval={version:"BRUA1-LEGAL-APPROVED-V1",sha256:"a".repeat(64),
  legally_reviewed:true,owner_signed_off:true,seller_verified:true,published:true,
  refundable_policy_approved:true};
const prodOperator={enable_real_money:true,production_paypal_verified:true,
  webhook_signature_qa_pass:true,delivery_integration_qa_pass:true,refund_reversal_qa_pass:true};
const prodProduct={product_id:"BRUA1-INS-0001",sale_enabled:true,rights_cleared:true,
  independent_qa_pass:true,private_assets_qa_pass:true};
function choose(id="BRUA1-INS-0001",tier="basic",mode="sandbox",values={}){
  return resolveLicenseSelection({catalog,productId:id,tier,mode,
    approval:values.approval??approval,product:values.product??{...prodProduct,product_id:id},
    operator:values.operator??(mode==="sandbox"?{sandbox_test_authorized:true}:prodOperator)});
}
test("all 108 requested prices and formats are canonical, three owner holds excluded",()=>{
  assert.deepEqual(verify36SkuMatrix(catalog).held,[...HELD_PRODUCTS]);
  const productIds=new Set(catalog.skus.map(r=>r.product_id));
  assert.equal(productIds.size,36);
  for(const sku of catalog.skus){
    assert.equal(choose(sku.product_id,sku.tier).priceCents,EXPECTED_PRICE_CENTS[sku.tier]);
    assert(!HELD_PRODUCTS.includes(sku.product_id));
  }
  for(const id of HELD_PRODUCTS)for(const tier of ["basic","premium","unlimited"])
    assert.throws(()=>choose(id,tier),/not eligible/);
  assert.throws(()=>choose("BRUA1-INS-0039","exclusive"));
  assert.throws(()=>choose("BRUA1-INS-9999","basic"));
  assert.throws(()=>resolveLicenseSelection({catalog,productId:"BRUA1-INS-0001",tier:"basic",mode:"sandbox",operator:{}}),/tester authorization/);
});
test("no production purchase unless legal, identity, rights, QA, payment and owner launch are approved",()=>{
  const baseline=choose("BRUA1-INS-0001","basic","production");
  assert.equal(baseline.paypalEnvironment,"production");
  assert.throws(()=>choose("BRUA1-INS-0001","basic","production",{approval:{...approval,legally_reviewed:false}}));
  assert.throws(()=>choose("BRUA1-INS-0001","basic","production",{approval:{...approval,version:"BRUA1-DRAFT-V2-2026-11-23"}}));
  assert.throws(()=>choose("BRUA1-INS-0001","basic","production",{approval:{...approval,seller_verified:false}}));
  assert.throws(()=>choose("BRUA1-INS-0001","basic","production",{product:{...prodProduct,rights_cleared:false}}));
  assert.throws(()=>choose("BRUA1-INS-0001","basic","production",{product:{...prodProduct,independent_qa_pass:false}}));
  assert.throws(()=>choose("BRUA1-INS-0001","basic","production",{operator:{...prodOperator,enable_real_money:false}}));
  assert.throws(()=>choose("BRUA1-INS-0001","basic","production",{operator:{...prodOperator,webhook_signature_qa_pass:false}}));
});
test("PayPal checkout payload ignores arbitrary browser price; approval hosts checked",()=>{
  const s=choose("BRUA1-INS-0001","premium");
  const request=makePayPalOrderRequest(s,"https://checkout.brua1.com/");
  assert.equal(request.purchase_units.length,1);
  assert.equal(request.purchase_units[0].amount.value,"59.99");
  assert.equal(request.purchase_units[0].amount.currency_code,"USD");
  assert.equal(request.purchase_units[0].custom_id,"BRUA1-INS-0001:premium:BRUA1-DRAFT-V2-2026-11-23");
  assert.match(request.purchase_units[0].description,/SANDBOX/);
  assert.equal(request.payment_source.paypal.experience_context.return_url,"https://checkout.brua1.com/checkout/return");
  assert.throws(()=>makePayPalOrderRequest({...s,priceCents:1},"https://checkout.brua1.com/"));
  assert.throws(()=>makePayPalOrderRequest(s,"http://checkout.brua1.com/"));
  assert.equal(validatePayPalApprovalLink("https://www.sandbox.paypal.com/checkoutnow?token=test","sandbox").startsWith("https://www.sandbox.paypal.com/"),true);
  assert.throws(()=>validatePayPalApprovalLink("https://www.paypal.com/checkoutnow","sandbox"));
  assert.throws(()=>validatePayPalApprovalLink("https://paypal.com.attacker.example/checkout","production"));
});
test("only completed, matched single PayPal capture from right merchant counts as paid",()=>{
  const s=choose("BRUA1-INS-0001","unlimited","production");
  const orderId="9XB31257TP234821E";
  const fixture=()=>({
    id:orderId,status:"COMPLETED",
    purchase_units:[{
      custom_id:s.customId,payee:{merchant_id:"BRUA1_MERCHANT_TEST"},
      amount:{currency_code:"USD",value:"99.99"},
      payments:{captures:[{id:"7AB341",status:"COMPLETED",
        amount:{currency_code:"USD",value:"99.99"},final_capture:true}]}
    }]
  });
  const ok=verifyCompletedPayPalOrder({providerOrder:fixture(),selection:s,expectedOrderId:orderId,merchantId:"BRUA1_MERCHANT_TEST"});
  assert.equal(ok.verified,true);assert.equal(ok.amount_cents,9999);
  const bads=[
    x=>x.status="APPROVED",
    x=>x.id="SPOOFED",
    x=>x.purchase_units[0].custom_id="BRUA1-INS-0039:unlimited:FAKE",
    x=>x.purchase_units[0].amount.value="1.00",
    x=>x.purchase_units[0].payee.merchant_id="ATTACKER",
    x=>x.purchase_units[0].payments.captures[0].status="PENDING",
    x=>x.purchase_units[0].payments.captures[0].amount.value="1.00",
    x=>x.purchase_units[0].payments.captures[0].final_capture=false,
    x=>x.purchase_units[0].payments.captures.push({...x.purchase_units[0].payments.captures[0]})
  ];
  for(const mutate of bads){
    const x=fixture();mutate(x);
    assert.throws(()=>verifyCompletedPayPalOrder({providerOrder:x,selection:s,expectedOrderId:orderId,merchantId:"BRUA1_MERCHANT_TEST"}));
  }
});
test("buyer must accept exact approved terms version and hash, with order/product/tier match",()=>{
  const s=choose("BRUA1-INS-0001","basic","production");
  const o="9XB31257TP234821E";
  const accepted={order_id:o,product_id:s.productId,tier:s.tier,terms_version:approval.version,
    terms_sha256:approval.sha256,accepted_at:"2026-11-23T22:00:00Z",affirmative_accepted:true};
  assert.equal(assertAcceptance({acceptance:accepted,selection:s,approval,orderId:o}),true);
  for(const ch of [{affirmative_accepted:false},{terms_version:"BRUA1-DRAFT-V2-2026-11-23"},
    {terms_sha256:"b".repeat(64)},{order_id:"OTHER"},{product_id:"BRUA1-INS-0039"},
    {tier:"unlimited"},{accepted_at:"INVALID"}])
    assert.throws(()=>assertAcceptance({acceptance:{...accepted,...ch},selection:s,approval,orderId:o}));
});
test("PayPal webhook is treated as untrusted until provider signature verified",async()=>{
  let calls=0;
  const webhook={id:"WH-1234567",event_type:"PAYMENT.CAPTURE.COMPLETED",resource:{id:"PAY-123"}};
  const headers=new Headers({
    "paypal-transmission-id":"TID","paypal-transmission-time":"2026-11-23T22:00:00Z",
    "paypal-cert-url":"https://api-m.sandbox.paypal.com/cert",
    "paypal-auth-algo":"SHA256withRSA","paypal-transmission-sig":"SIGNATURE"
  });
  const mocked=async(url,options)=>{
    calls++;assert.equal(url,"https://api-m.sandbox.paypal.com/v1/notifications/verify-webhook-signature");
    const sent=JSON.parse(options.body);
    assert.equal(sent.webhook_id,"WEBHOOK-OWNER-ID");
    assert.equal(sent.webhook_event.id,webhook.id);
    return Response.json({verification_status:"SUCCESS"});
  };
  const v=await verifyPayPalWebhook({headers,webhook,webhookId:"WEBHOOK-OWNER-ID",accessToken:"MOCK_ACCESS",mode:"sandbox",transport:mocked});
  assert.equal(v.verified,true);assert.equal(calls,1);
  assert.equal(eventAction(v).action,"RECHECK_ORDER_THEN_CONSIDER_FULFILLMENT");
  await assert.rejects(verifyPayPalWebhook({headers:new Headers(),webhook,webhookId:"WEBHOOK-OWNER-ID",accessToken:"MOCK_ACCESS",mode:"sandbox",transport:mocked}));
  await assert.rejects(verifyPayPalWebhook({headers,webhook,webhookId:"WEBHOOK-OWNER-ID",accessToken:"MOCK_ACCESS",mode:"sandbox",transport:async()=>Response.json({verification_status:"FAILURE"})}));
});
test("authentic refund, reversal and dispute events require revocation and review",()=>{
  for(const type of ["PAYMENT.CAPTURE.REFUNDED","PAYMENT.CAPTURE.REVERSED","CUSTOMER.DISPUTE.CREATED"]){
    const act=eventAction({verified:true,event_id:"WH-REV-123",type});
    assert.equal(act.invalidate_download_grants,true);assert.equal(act.action,"REVOKE_ENTITLEMENTS_AND_RECONCILE");
  }
  assert.throws(()=>eventAction({verified:false,event_id:"NOT_AUTHENTIC",type:"PAYMENT.CAPTURE.COMPLETED"}));
});
