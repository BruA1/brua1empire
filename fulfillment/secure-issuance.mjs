/**
 * BruA1 INTERNAL purchase-to-download authorization service.
 * Not deployed to a live payment route. Accepts ONLY an order ID + format
 * from authenticated internal automation. Trust comes from D1, PayPal REST,
 * and R2 metadata, NOT from any client-supplied price, buyer or file name.
 *
 * Only an ALREADY ISSUED, legally approved immutable license may receive
 * a short-lived buyer download grant. This does not itself issue a license.
 */
import {fulfillmentDecision,PRICES,FORMAT_BY_TIER,PAYPAL_ORDER_ID} from "./core.mjs";
import {verifyCompletedPayPalOrder,HELD_PRODUCTS} from "./paypal-payment-gates.mjs";
import {issuePurchaseDownloadGrant} from "./private-delivery.mjs";

const BASE="https://api-m.paypal.com";
const trim=(s)=>typeof s==="string"?s.trim():"";
const issuedStatus=(row)=>row?.status==="ISSUED"&&!row.revoked_at;
const fromD1Bool=x=>Number(x)===1;
const dateValid=x=>typeof x==="string"&&x.length>0&&Number.isFinite(Date.parse(x));

export function productionConfigFromEnv(env){
 return Object.freeze({
  enabled:env?.LIVE_DELIVERY_ENABLED==="true",
  owner_signed_off:env?.OWNER_FINAL_GO_LIVE_SIGNOFF==="true",
  environment:env?.PAYPAL_ENVIRONMENT,
  agreement_status:env?.AGREEMENT_STATUS,
  approved_terms_published:env?.FINAL_TERMS_PUBLISHED==="true",
  approved_terms_version:env?.APPROVED_TERMS_VERSION,
  approved_terms_sha256:env?.APPROVED_TERMS_SHA256,
  merchant_identity_verified:env?.MERCHANT_IDENTITY_VERIFIED==="true",
  allowed_origin:env?.ALLOWED_ORIGIN
 });
}

export function productionDeliveryEnabled(env,config=productionConfigFromEnv(env)){
 return Boolean(config.enabled===true&&config.owner_signed_off===true&&
   config.environment==="production"&&config.agreement_status==="LEGAL_APPROVED"&&
   config.approved_terms_published===true&&
   /^BRUA1-LEGAL-APPROVED-[A-Z0-9_-]+$/.test(config.approved_terms_version||"")&&
   /^[a-f0-9]{64}$/.test(config.approved_terms_sha256||"")&&
   config.merchant_identity_verified===true&&
   env?.PRODUCTION_PAYPAL_QA_PASS==="true"&&
   env?.DELIVERY_INTEGRATION_QA_PASS==="true"&&
   env?.REFUND_AND_DISPUTE_QA_PASS==="true"&&
   env?.RIGHTS_REVIEW_COMPLETED==="true"&&
   env?.BUYER_RECEIPT_SERVICE_QA_PASS==="true"&&
   env?.PRIVACY_AND_REFUND_POLICY_APPROVED==="true"&&
   env?.PAYPAL_CLIENT_ID&&env?.PAYPAL_CLIENT_SECRET&&
   env?.PAYPAL_MERCHANT_ID&&env?.INTERNAL_FULFILLMENT_KEY&&
   env?.ORDERS_DB&&env?.INSTRUMENTAL_MASTERS&&
   config.allowed_origin==="https://brua1.com");
}

async function paypalGetVerifiedOrder(env,orderId,transport){
 const auth=await transport(BASE+"/v1/oauth2/token",{
  method:"POST",
  headers:{"Content-Type":"application/x-www-form-urlencoded",
    Authorization:"Basic "+btoa(env.PAYPAL_CLIENT_ID+":"+env.PAYPAL_CLIENT_SECRET)},
  body:"grant_type=client_credentials"
 });
 if(!auth.ok)throw Error("Payment provider authorization unavailable");
 const access=(await auth.json()).access_token;
 if(typeof access!=="string"||!access)throw Error("Payment provider authorization unavailable");
 const response=await transport(BASE+"/v2/checkout/orders/"+orderId,{
  method:"GET",headers:{Authorization:"Bearer "+access,Accept:"application/json"}
 });
 if(!response.ok)throw Error("Completed order could not be independently checked");
 return response.json();
}

async function readDatabaseRecord(db,sql,args){
 return db.prepare(sql).bind(...args).first();
}

/** Issue a short-lived delivery token for an existing legally issued license.
 * A trusted server process should send that token to the buyer through the
 * approved receipt/delivery service. Never expose this route to a buyer.
 */
export async function authorizePaidDownload({
 env,orderId,format,transport=fetch,config=productionConfigFromEnv(env)
}){
 if(!productionDeliveryEnabled(env,config))throw Error("Fulfillment disabled pending final approvals");
 if(!PAYPAL_ORDER_ID.test(orderId||"")||!["mp3","wav"].includes(format))
  throw Error("Invalid order or delivery format");
 const db=env.ORDERS_DB;
 const order=await readDatabaseRecord(db,
  "SELECT paypal_order_id,product_id,license_tier,amount_cents,currency,buyer_email,status,paypal_capture_id,refunded_at,chargeback_at,revoked_at FROM commerce_orders WHERE paypal_order_id=?", [orderId]);
 if(!order||HELD_PRODUCTS.includes(order.product_id)||
    !FORMAT_BY_TIER[order.license_tier]?.includes(format)||
    order.status!=="COMPLETED"||order.refunded_at||order.chargeback_at||order.revoked_at||
    !PRICES[order.license_tier]||Number(order.amount_cents)!==PRICES[order.license_tier]||
    order.currency!=="USD"||!order.paypal_capture_id)throw Error("Paid entitlement unavailable");
 const product=await readDatabaseRecord(db,
  "SELECT product_id,title,sale_enabled,rights_cleared,independent_qa_pass FROM commerce_products WHERE product_id=?", [order.product_id]);
 if(!product||!fromD1Bool(product.sale_enabled)||!fromD1Bool(product.rights_cleared)||
    !fromD1Bool(product.independent_qa_pass))throw Error("Track has not passed release QA");
 const accept=await readDatabaseRecord(db,
  "SELECT paypal_order_id,product_id,license_tier,terms_version,terms_sha256,affirmatively_accepted,accepted_at FROM commerce_terms_acceptance WHERE paypal_order_id=? AND terms_version=?",
  [orderId,config.approved_terms_version]);
 if(!accept||!fromD1Bool(accept.affirmatively_accepted)||accept.product_id!==order.product_id||
    accept.license_tier!==order.license_tier||accept.terms_sha256!==config.approved_terms_sha256||
    !dateValid(accept.accepted_at))throw Error("Exact final agreement was not accepted");
 const license=await readDatabaseRecord(db,
  "SELECT license_id,paypal_order_id,product_id,tier,agreement_version,agreement_sha256,document_sha256,status,buyer_email,issued_at,revoked_at FROM commerce_licenses WHERE paypal_order_id=?", [orderId]);
 if(!issuedStatus(license)||license.paypal_order_id!==orderId||
    license.product_id!==order.product_id||license.tier!==order.license_tier||
    license.buyer_email!==order.buyer_email||
    license.agreement_version!==config.approved_terms_version||
    license.agreement_sha256!==config.approved_terms_sha256||
    !/^[a-f0-9]{64}$/.test(license.document_sha256||"")||!dateValid(license.issued_at))
    throw Error("No valid buyer-specific issued license");
 const assets={};
 for(const fmt of FORMAT_BY_TIER[order.license_tier]){
  const a=await readDatabaseRecord(db,
    "SELECT product_id,format,r2_object_key,rights_cleared,independent_qa_pass,private_r2_qa_pass FROM commerce_audio_assets WHERE product_id=? AND format=?",
    [order.product_id,fmt]);
  if(!a||a.format!==fmt||a.product_id!==order.product_id||
     !fromD1Bool(a.rights_cleared)||!fromD1Bool(a.independent_qa_pass)||
     !fromD1Bool(a.private_r2_qa_pass)||!trim(a.r2_object_key))
     throw Error("Licensed audio asset has not passed QA");
  const metadata=await env.INSTRUMENTAL_MASTERS.head(a.r2_object_key);
  if(!metadata||!Number.isFinite(metadata.size)||metadata.size<2048)
     throw Error("Private licensed audio asset unavailable");
  assets[fmt]={private_key:a.r2_object_key,rights_cleared:true,independent_qa_pass:true,
    exists_in_private_r2:true,content_type_checked:true};
 }
 // Always re-read the actual PayPal order using the seller's LIVE API credentials.
 const providerOrder=await paypalGetVerifiedOrder(env,orderId,transport);
 const selection={productId:order.product_id,tier:order.license_tier,priceCents:PRICES[order.license_tier],
   sku:order.product_id+"-"+order.license_tier.toUpperCase(),
   customId:order.product_id+":"+order.license_tier+":"+config.approved_terms_version};
 const pay=verifyCompletedPayPalOrder({
   providerOrder,selection,expectedOrderId:orderId,merchantId:env.PAYPAL_MERCHANT_ID
 });
 if(pay.capture_id!==order.paypal_capture_id)throw Error("Stored capture does not match PayPal");
 const orderForDecision={...order,amount_cents:Number(order.amount_cents)};
 const acceptance={order_id:accept.paypal_order_id,product_id:accept.product_id,
   tier:accept.license_tier,terms_version:accept.terms_version,
   terms_sha256:accept.terms_sha256,accepted_at:accept.accepted_at,
   affirmative_accepted:true};
 const dec=fulfillmentDecision({order:orderForDecision,
   product:{...product,sale_enabled:true,rights_cleared:true,independent_qa_pass:true},
   verifiedPayment:{verified_by_server:true,status:pay.status,order_id:pay.order_id,
     capture_id:pay.capture_id,currency:pay.currency,amount_cents:pay.amount_cents,
     product_id:pay.product_id,tier:pay.tier},
   acceptance,config,assets
 });
 if(!dec.allowed)throw Error("Independent fulfillment gates denied delivery: "+dec.blockers.join(","));
 const rec={license_id:license.license_id,order_id:orderId,product_id:order.product_id,
   tier:order.license_tier,agreement_version:license.agreement_version,
   record_status:"ISSUED_FROM_VERIFIED_ACCEPTANCE",
   legal_document_delivery_required:true};
 const grant=await issuePurchaseDownloadGrant({
  env,config,decision:dec,licenseRecord:rec,order:orderForDecision,format
 });
 // Omit the customer's personal data, private R2 object key and source filename.
 return Object.freeze({...grant,product_id:order.product_id,tier:order.license_tier});
}
