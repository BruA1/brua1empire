// Authenticated buyer-session delivery. Server-only; never trusts an order ID alone.
import {sha256,productionCheckoutReady} from "./production-checkout-service.mjs";
import {authorizePaidDownload,productionConfigFromEnv,productionDeliveryEnabled} from "./secure-issuance.mjs";
import {streamLicensedAudio} from "./private-delivery.mjs";
import {EXPECTED_FORMATS} from "./paypal-payment-gates.mjs";
const hash=/^[a-f0-9]{64}$/;
const uuid=/^[a-f0-9-]{36}$/;
const stmt=(db,sql,...args)=>db.prepare(sql).bind(...args);
function config(env){
 const delivery={...env,PAYPAL_ENVIRONMENT:"production",LIVE_DELIVERY_ENABLED:env.REAL_AUDIO_DELIVERY_ENABLED,ALLOWED_ORIGIN:"https://brua1.com"};
 return {delivery,settings:productionConfigFromEnv(delivery)};
}
export async function buyerGrants(env,input,transport=fetch){
 if(!productionCheckoutReady(env)||env.BUYER_DELIVERY_ROUTE_VERIFIED!=="true"||env.WEBHOOK_RECONCILIATION_VERIFIED!=="true")throw Error("Checkout locked");
 const {delivery,settings}=config(env);
 if(!productionDeliveryEnabled(delivery,settings,false))throw Error("Delivery locked");
 if(!uuid.test(input?.sessionId||"")||!hash.test(input?.sessionToken||""))throw Error("Invalid buyer session");
 const db=env.ORDERS_DB;
 const row=await stmt(db,"SELECT s.*,l.license_id,l.document_sha256,d.document_text,d.document_sha256 AS stored_hash,d.schedule_version AS issued_schedule_version,d.schedule_hash AS issued_schedule_hash,p.schedule_version AS accepted_schedule_version,p.schedule_sha256 AS accepted_schedule_hash FROM commerce_checkout_sessions s JOIN commerce_licenses l ON l.paypal_order_id=s.paypal_order_id JOIN commerce_license_documents d ON d.license_id=l.license_id JOIN commerce_publishing_acceptance p ON p.paypal_order_id=s.paypal_order_id WHERE s.session_id=? AND s.token_hash=? AND s.status='COMPLETED' AND l.status='ISSUED' AND l.revoked_at IS NULL",input.sessionId,await sha256(input.sessionToken)).first();
 if(!row||row.document_sha256!==row.stored_hash||await sha256(row.document_text)!==row.stored_hash||row.schedule_version!==row.issued_schedule_version||row.schedule_hash!==row.issued_schedule_hash||row.schedule_version!==row.accepted_schedule_version||row.schedule_hash!==row.accepted_schedule_hash)throw Error("No validated issued buyer license");
 const formats=EXPECTED_FORMATS[row.tier];if(!formats)throw Error("Unknown tier");
 const grants=[];
 for(const format of formats){
  const grantToken=await sha256("brua1-buyer-grant-v1:"+input.sessionToken+":"+row.license_id+":"+format);
  const grant=await authorizePaidDownload({env:delivery,config:settings,orderId:row.paypal_order_id,format,transport,grantToken,internalOnly:false});
  grants.push({format,token:grant.token,expiresAtEpoch:grant.expires_at_epoch,maxDownloads:grant.max_downloads});
 }
 return {licenseId:row.license_id,licenseDocument:row.document_text,grants};
}
export async function buyerDownload(env,request){
 const {delivery,settings}=config(env);
 if(!productionCheckoutReady(env)||env.BUYER_DELIVERY_ROUTE_VERIFIED!=="true"||env.WEBHOOK_RECONCILIATION_VERIFIED!=="true"||!productionDeliveryEnabled(delivery,settings,false))return Response.json({error:"Delivery disabled"},{status:503});
 return streamLicensedAudio({env:delivery,config:settings,request});
}
