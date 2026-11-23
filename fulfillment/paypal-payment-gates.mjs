/**
 * BruA1 — payment contract and finalization gates. NO LIVE PAYMENTS in this module.
 * Intended for a future isolated server-only Worker. It never handles browser
 * supplied prices, private R2 keys or PayPal credentials.
 *
 * Design notes: PayPal Orders v2, capture status/payment verification, webhook
 * signature verification (see developer.paypal.com/api/orders/v2 and
 * developer.paypal.com/api/rest/webhooks/rest).
 */
export const HELD_PRODUCTS=Object.freeze(["BRUA1-INS-0004","BRUA1-INS-0019","BRUA1-INS-0026"]);
export const EXPECTED_PRICE_CENTS=Object.freeze({basic:2999,premium:5999,unlimited:9999});
export const EXPECTED_FORMATS=Object.freeze({basic:Object.freeze(["mp3"]),premium:Object.freeze(["mp3","wav"]),unlimited:Object.freeze(["mp3","wav"])});
const PRICE_KEYS=Object.freeze(["basic","premium","unlimited"]);
const ID=/^BRUA1-INS-\d{4}$/;
const HASH=/^[a-f0-9]{64}$/;
const ORDER_ID=/^[A-Z0-9]{10,30}$/;
export const PAYMENT_EVENTS=Object.freeze([
  "PAYMENT.CAPTURE.COMPLETED","PAYMENT.CAPTURE.REFUNDED","PAYMENT.CAPTURE.REVERSED","CUSTOMER.DISPUTE.CREATED"
]);

export function verify36SkuMatrix(catalog) {
  if(!catalog||catalog.environment!=="STAGING_ONLY"||catalog.items_in_batch!==36 ||
     catalog.skus_total!==108||!Array.isArray(catalog.skus)||catalog.skus.length!==108)
    throw Error("Refusing mismatched / non-staging launch catalog");
  const ids=new Set(),skus=new Set();
  for(const rec of catalog.skus){
    if(!ID.test(rec.product_id||"")||HELD_PRODUCTS.includes(rec.product_id)||
       !PRICE_KEYS.includes(rec.tier)||rec.sku!==rec.product_id+"-"+rec.tier.toUpperCase()||
       rec.price_cents!==EXPECTED_PRICE_CENTS[rec.tier]||rec.currency!=="USD"||
       JSON.stringify(rec.files)!==JSON.stringify(EXPECTED_FORMATS[rec.tier])||
       rec.checkout_enabled!==false||rec.fulfillment_enabled!==false||
       rec.rights_cleared!==false||rec.independently_content_qa_pass!==false)
      throw Error("Unsafe or incorrectly priced launch SKU");
    if(skus.has(rec.sku))throw Error("Duplicate launch SKU");
    skus.add(rec.sku);ids.add(rec.product_id);
  }
  if(ids.size!==36||skus.size!==108)throw Error("Expected 36 tracks x three license tiers");
  for(const id of ids)for(const t of PRICE_KEYS)if(!skus.has(id+"-"+t.toUpperCase()))throw Error("Missing tier");
  return Object.freeze({tracks:36,skuCount:108,held:Object.freeze([...HELD_PRODUCTS]),validated:true});
}

function approvedTermsForPurchase(approval) {
  return approval?.version?.startsWith("BRUA1-LEGAL-APPROVED-")===true &&
    approval?.legally_reviewed===true && approval?.owner_signed_off===true &&
    approval?.seller_verified===true && approval?.published===true &&
    approval?.refundable_policy_approved===true && HASH.test(approval?.sha256||"");
}
export function resolveLicenseSelection({catalog,productId,tier,mode="sandbox",approval,product,operator}) {
  verify36SkuMatrix(catalog);
  if(!ID.test(productId||"")||HELD_PRODUCTS.includes(productId)||!PRICE_KEYS.includes(tier))
    throw Error("Track or license tier is not eligible");
  const rec=catalog.skus.find(x=>x.product_id===productId&&x.tier===tier);
  if(!rec)throw Error("SKU is not in the approved preparation catalog");
  if(mode!=="sandbox"&&mode!=="production")throw Error("Unknown payment environment");
  if(mode==="production"){
    // These gates are intentionally NOT satisfied by today's records.
    if(!approvedTermsForPurchase(approval)||operator?.enable_real_money!==true||
       operator?.production_paypal_verified!==true||
       operator?.webhook_signature_qa_pass!==true||
       operator?.delivery_integration_qa_pass!==true||
       operator?.refund_reversal_qa_pass!==true||
       product?.product_id!==productId||product?.sale_enabled!==true||
       product?.rights_cleared!==true||product?.independent_qa_pass!==true||
       product?.private_assets_qa_pass!==true)
      throw Error("Production purchase is blocked until every launch gate passes");
  }else if(operator?.sandbox_test_authorized!==true){
    throw Error("Sandbox purchase requires explicit tester authorization");
  }
  const termsVersion=mode==="production"?approval.version:"BRUA1-DRAFT-V2-2026-11-23";
  const customId=[rec.product_id,rec.tier,termsVersion].join(":");
  if(customId.length>127)throw Error("Checkout reference too long");
  return Object.freeze({
    productId:rec.product_id,tier:rec.tier,sku:rec.sku,priceCents:rec.price_cents,currency:"USD",
    formats:Object.freeze([...EXPECTED_FORMATS[tier]]),termsVersion,customId,
    paypalEnvironment:mode,fulfillment:mode==="production"?"APPROVED_LICENSE_REQUIRED":"HARMLESS_TEST_RECEIPT_ONLY"
  });
}
export function makePayPalOrderRequest(selection,siteOrigin) {
  const origin=new URL(siteOrigin);
  if(origin.protocol!=="https:"||origin.username||origin.password||origin.search||origin.hash||origin.pathname!=="/")
    throw Error("HTTPS checkout origin required");
  const value=(selection.priceCents/100).toFixed(2);
  if(selection.priceCents!==EXPECTED_PRICE_CENTS[selection.tier]||
     selection.currency!=="USD"||HELD_PRODUCTS.includes(selection.productId))
    throw Error("Untrusted checkout selection rejected");
  return Object.freeze({
    intent:"CAPTURE",
    purchase_units:[{
      custom_id:selection.customId,
      description:"BruA1 "+selection.tier.toUpperCase()+" Instrumental License"+(selection.paypalEnvironment==="sandbox"?" — SANDBOX ONLY":""),
      amount:{currency_code:"USD",value}
    }],
    payment_source:{paypal:{experience_context:{
      brand_name:selection.paypalEnvironment==="sandbox"?"BruA1 Empire Sandbox":"BruA1 Empire",
      user_action:"PAY_NOW",
      return_url:origin.origin+"/checkout/return",
      cancel_url:origin.origin+"/checkout/cancel"
    }}}
  });
}
export function validatePayPalApprovalLink(approvalUrl,mode) {
  let u;
  try{u=new URL(approvalUrl);}catch{throw Error("Invalid PayPal approval link");}
  const expectedHost=mode==="sandbox"?"www.sandbox.paypal.com":"www.paypal.com";
  if(u.protocol!=="https:"||u.hostname!==expectedHost||u.username||u.password)
    throw Error("Untrusted payment approval redirect");
  return u.toString();
}
/**
 * Verify an order returned by GET /v2/checkout/orders/{id} or capture response.
 * Caller MUST be an authenticated server-side PayPal REST client; no browser
 * response or webhook payload is sufficient to issue an entitlement.
 */
export function verifyCompletedPayPalOrder({providerOrder,selection,expectedOrderId,merchantId}) {
  if(!ORDER_ID.test(expectedOrderId||"")||!merchantId||typeof merchantId!=="string"||
     providerOrder?.id!==expectedOrderId||providerOrder?.status!=="COMPLETED"||
     providerOrder?.purchase_units?.length!==1)
    throw Error("PayPal order was not independently verified");
  const pu=providerOrder.purchase_units[0],amount=pu.amount;
  if(pu.custom_id!==selection.customId||amount?.currency_code!=="USD"||
     amount?.value!==(selection.priceCents/100).toFixed(2)||
     pu.payee?.merchant_id!==merchantId)
    throw Error("PayPal order product, merchant, currency or price mismatch");
  const cap=pu.payments?.captures;
  if(!Array.isArray(cap)||cap.length!==1)throw Error("Expected one completed capture");
  const capture=cap[0];
  if(!capture.id||capture.status!=="COMPLETED"||
     capture.amount?.currency_code!=="USD"||
     capture.amount?.value!==(selection.priceCents/100).toFixed(2)||
     capture.final_capture!==true)
    throw Error("PayPal capture not settled or amount mismatch");
  return Object.freeze({
    order_id:expectedOrderId,capture_id:capture.id,verified:true,
    merchant_id:merchantId,sku:selection.sku,product_id:selection.productId,
    tier:selection.tier,amount_cents:selection.priceCents,currency:"USD",
    status:"COMPLETED",verified_by_server:true
  });
}
export function assertAcceptance({acceptance,selection,approval,orderId}) {
  if(!approvedTermsForPurchase(approval)||!acceptance?.affirmative_accepted||
     acceptance.order_id!==orderId||acceptance.product_id!==selection.productId||
     acceptance.tier!==selection.tier||acceptance.terms_version!==approval.version||
     acceptance.terms_sha256!==approval.sha256||!acceptance.accepted_at ||
     !Number.isFinite(Date.parse(acceptance.accepted_at)))
    throw Error("An accepted, legally reviewed and hashed purchase agreement is required");
  return true;
}
/** PayPal's REST signature verification API verifies the authentic webhook. */
export async function verifyPayPalWebhook({headers,webhook,webhookId,accessToken,mode,transport=fetch}) {
  if(!["sandbox","production"].includes(mode)||!webhookId||!accessToken||
     !webhook||typeof webhook!=="object"||!webhook.id||
     typeof webhook.event_type!=="string")
    throw Error("Webhook validation configuration incomplete");
  const get=n=>headers.get?.(n)||headers[n]||headers[n.toLowerCase()];
  const transmission_id=get("paypal-transmission-id");
  const transmission_time=get("paypal-transmission-time");
  const cert_url=get("paypal-cert-url");
  const auth_algo=get("paypal-auth-algo");
  const transmission_sig=get("paypal-transmission-sig");
  if(!transmission_id||!transmission_time||!transmission_sig||
     !auth_algo||!cert_url||!String(cert_url).startsWith("https://"))
    throw Error("Missing PayPal signature headers");
  // PayPal accepts an authentic webhook event and its associated headers.
  const base=mode==="production"?"https://api-m.paypal.com":"https://api-m.sandbox.paypal.com";
  const response=await transport(base+"/v1/notifications/verify-webhook-signature",{
    method:"POST",
    headers:{Authorization:"Bearer "+accessToken,"Content-Type":"application/json"},
    body:JSON.stringify({transmission_id,transmission_time,cert_url,auth_algo,transmission_sig,
      webhook_id:webhookId,webhook_event:webhook})
  });
  if(!response.ok)throw Error("PayPal webhook verification endpoint rejected the request");
  const result=await response.json();
  if(result?.verification_status!=="SUCCESS")throw Error("PayPal webhook signature could not be verified");
  return Object.freeze({verified:true,event_id:webhook.id,type:webhook.event_type,
    relevant:PAYMENT_EVENTS.includes(webhook.event_type),
    requires_reconciliation:webhook.event_type!=="PAYMENT.CAPTURE.COMPLETED"});
}
export const REFUND_OR_DISPUTE_EVENTS=Object.freeze([
  "PAYMENT.CAPTURE.REFUNDED","PAYMENT.CAPTURE.REVERSED","CUSTOMER.DISPUTE.CREATED"
]);
export function eventAction(verification){
  if(!verification?.verified||typeof verification.event_id!=="string"||!verification.event_id)
    throw Error("Unauthenticated payment event");
  if(REFUND_OR_DISPUTE_EVENTS.includes(verification.type))
    return Object.freeze({action:"REVOKE_ENTITLEMENTS_AND_RECONCILE",dedupe_key:verification.event_id,
      invalidate_download_grants:true,manual_dispute_review:true});
  if(verification.type==="PAYMENT.CAPTURE.COMPLETED")
    return Object.freeze({action:"RECHECK_ORDER_THEN_CONSIDER_FULFILLMENT",dedupe_key:verification.event_id,
      invalidate_download_grants:false});
  return Object.freeze({action:"IGNORE_UNSUPPORTED_EVENT",dedupe_key:verification.event_id});
}
