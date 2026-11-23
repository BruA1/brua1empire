/**
 * BruA1 Fulfillment Core — DESIGN/STAGING ONLY.
 * This module does not enable checkout, bind R2, or issue legally operative licenses.
 * All order/payment/acceptance records supplied here MUST be obtained server-side,
 * never from untrusted browser JSON. All gate failures deny access.
 */
export const PRICES = Object.freeze({basic:2999,premium:5999,unlimited:9999});
export const FORMAT_BY_TIER = Object.freeze({
  basic:Object.freeze(["mp3"]),
  premium:Object.freeze(["mp3","wav"]),
  unlimited:Object.freeze(["mp3","wav"])
});
export const DRAFT_TERMS_VERSION = "BRUA1-DRAFT-V2-2026-11-23";
export const ALLOWED_FORMATS = new Set(["mp3","wav"]);
export const PAYPAL_ORDER_ID = /^[A-Z0-9]{10,30}$/;
export const PRODUCT_ID = /^BRUA1-INS-\d{4}$/;
export const TOKEN_PATTERN = /^[a-f0-9]{64}$/;
const own = (obj,k) => Object.prototype.hasOwnProperty.call(obj||{},k);
const isBoolTrue = x => x === true;

export function fulfillmentDecision({order,product,verifiedPayment,acceptance,config,assets}) {
  const blocks = [];
  const tier = order?.license_tier;
  const priceCents = PRICES[tier];
  if(!isBoolTrue(config?.enabled))blocks.push("FULFILLMENT_DISABLED");
  if(config?.environment!=="production")blocks.push("NON_PRODUCTION_ENVIRONMENT");
  if(config?.agreement_status!=="LEGAL_APPROVED")blocks.push("AGREEMENT_NOT_APPROVED");
  if(!isBoolTrue(config?.merchant_identity_verified))blocks.push("MERCHANT_NOT_VERIFIED");
  if(!config?.approved_terms_version || config.approved_terms_version===DRAFT_TERMS_VERSION)blocks.push("DRAFT_OR_MISSING_TERMS");
  if(!order || !PAYPAL_ORDER_ID.test(order.paypal_order_id||"") || !PRODUCT_ID.test(order.product_id||"") || !own(PRICES,tier))
    blocks.push("INVALID_ORDER");
  if(!order || order.status!=="COMPLETED" || order.refunded_at || order.chargeback_at || order.revoked_at)
    blocks.push("ORDER_UNPAID_OR_REVOKED");
  if(!Number.isInteger(priceCents) || order?.amount_cents!==priceCents || order.currency!=="USD")
    blocks.push("ORDER_PRICE_MISMATCH");
  if(!product || product.product_id!==order?.product_id || !PRODUCT_ID.test(product?.product_id||"") ||
    product.sale_enabled!==true || product.rights_cleared!==true || product.independent_qa_pass!==true)
    blocks.push("PRODUCT_NOT_CLEARED");
  if(verifiedPayment?.verified_by_server!==true || verifiedPayment?.status!=="COMPLETED" ||
    verifiedPayment?.order_id!==order?.paypal_order_id || verifiedPayment?.capture_id!==order?.paypal_capture_id ||
    verifiedPayment?.currency!=="USD" || verifiedPayment?.amount_cents!==priceCents ||
    verifiedPayment?.product_id!==order?.product_id || verifiedPayment?.tier!==tier)
    blocks.push("PAYMENT_NOT_VERIFIED");
  if(!acceptance || acceptance?.order_id!==order?.paypal_order_id || acceptance?.product_id!==order?.product_id ||
    acceptance?.tier!==tier || acceptance?.terms_version!==config?.approved_terms_version ||
    typeof acceptance?.accepted_at!=="string" || !acceptance.accepted_at ||
    typeof acceptance?.terms_sha256!=="string" || !/^[a-f0-9]{64}$/.test(acceptance.terms_sha256) ||
    acceptance?.terms_sha256!==config?.approved_terms_sha256 ||
    acceptance?.affirmative_accepted!==true)
    blocks.push("TERMS_ACCEPTANCE_NOT_VERIFIED");
  if(!order?.buyer_email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(order.buyer_email))
    blocks.push("BUYER_IDENTITY_MISSING");
  const formats=FORMAT_BY_TIER[tier]||[];
  for(const format of formats){
    const a=assets?.[format];
    if(!a?.private_key || a?.independent_qa_pass!==true || a?.rights_cleared!==true ||
       a?.exists_in_private_r2!==true || a?.content_type_checked!==true)
      blocks.push("ASSET_NOT_CLEARED_"+format.toUpperCase());
  }
  return Object.freeze({allowed:blocks.length===0,blockers:Object.freeze(blocks),product_id:order?.product_id||null,
    tier:tier||null,formats:Object.freeze([...formats]),amount_cents:priceCents||null});
}

/** Immutable audit metadata; attach an exact legally approved agreement separately.
 * This is not itself a valid contract and MUST NOT stand in for legal counsel review.
 */
export function createLicenseRecord({order,acceptedTerms,issueAt,licenseId,documentHash,config}) {
  if(!config || config.agreement_status!=="LEGAL_APPROVED" || !config.approved_terms_version ||
     config.approved_terms_version===DRAFT_TERMS_VERSION)
    throw Error("Agreement must be legally approved before license issuance");
  if(!order || order.status!=="COMPLETED" || !PRODUCT_ID.test(order.product_id||"") ||
     !own(PRICES,order.license_tier) || typeof order.buyer_email!=="string")
    throw Error("Verified purchase details required");
  if(!acceptedTerms?.affirmative_accepted ||
     acceptedTerms.terms_version!==config.approved_terms_version ||
     acceptedTerms.terms_sha256!==config.approved_terms_sha256 ||
     acceptedTerms.order_id!==order.paypal_order_id)
    throw Error("Exact terms acceptance evidence required");
  if(typeof issueAt!=="string" || !issueAt || typeof licenseId!=="string" || !licenseId ||
     typeof documentHash!=="string" || !/^[a-f0-9]{64}$/.test(documentHash))
    throw Error("Immutable license timestamp, identifier and document hash required");
  return Object.freeze({
    license_id:licenseId,issued_at:issueAt,order_id:order.paypal_order_id,
    capture_id:order.paypal_capture_id,product_id:order.product_id,
    tier:order.license_tier,buyer_email:order.buyer_email,
    agreement_version:config.approved_terms_version,agreement_sha256:documentHash,
    accepted_terms_sha256:acceptedTerms.terms_sha256,
    permitted_formats:Object.freeze([...FORMAT_BY_TIER[order.license_tier]]),
    record_status:"ISSUED_FROM_VERIFIED_ACCEPTANCE",
    legal_document_delivery_required:true
  });
}
export function planStagingReceipt({order,product,requestedTier}) {
  if(!order || !product || order.product_id!==product.product_id || !own(PRICES,requestedTier))
    throw Error("Unknown sandbox product or tier");
  return Object.freeze({
    simulation_only:true,is_license:false,real_audio_delivery:false,
    product_id:product.product_id,title:product.title,tier:requestedTier,
    amount_cents:PRICES[requestedTier],currency:"USD",
    message:"TEST-ONLY RECEIPT. Draft terms do not grant rights. No private MP3/WAV."
  });
}
