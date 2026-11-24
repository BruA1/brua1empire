// Production PayPal transport, staged only. No public routes call this module.
// Callers must supply a verified selection, accepted terms, and a durable order
// state machine. Never pass browser-supplied prices or merchant identifiers.
import {makePayPalOrderRequest,validatePayPalApprovalLink,verifyCompletedPayPalOrder} from "./paypal-payment-gates.mjs";
const BASE="https://api-m.paypal.com";
const ID=/^[A-Z0-9]{10,30}$/;
const REQUEST=/^[A-Za-z0-9_-]{1,108}$/;
export function productionPayPalClient(env,transport=fetch){
 if(env?.PAYPAL_ENVIRONMENT!=="live"||env?.LIVE_CHECKOUT_ENABLED!=="true"||
   env?.LICENSE_ISSUANCE_ENABLED!=="true"||env?.REAL_AUDIO_DELIVERY_ENABLED!=="true"||
   env?.MERCHANT_IDENTITY_VERIFIED!=="true"||!env.PAYPAL_CLIENT_ID||!env.PAYPAL_CLIENT_SECRET||
   !/^[A-Z0-9]{8,30}$/.test(env.PAYPAL_MERCHANT_ID||""))
   throw Error("Production PayPal is not authorized");
 let token;
 async function request(path,method="GET",body,requestId){
  if(method==="POST"&&!REQUEST.test(requestId||""))throw Error("Stable idempotency key required");
  if(!token){
   const res=await transport(BASE+"/v1/oauth2/token",{method:"POST",headers:{Authorization:"Basic "+btoa(env.PAYPAL_CLIENT_ID+":"+env.PAYPAL_CLIENT_SECRET),"Content-Type":"application/x-www-form-urlencoded"},body:"grant_type=client_credentials"});
   if(!res.ok)throw Error("PayPal authentication failed");
   const data=await res.json();
   if(typeof data.access_token!=="string"||!data.access_token)throw Error("PayPal token unavailable");
   token=data.access_token;
  }
  const headers={Authorization:"Bearer "+token,Accept:"application/json","Content-Type":"application/json",Prefer:"return=representation"};
  if(method==="POST")headers["PayPal-Request-Id"]=requestId;
  const r=await transport(BASE+path,{method,headers,body:body===undefined?undefined:JSON.stringify(body)});
  if(!r.ok)throw Error("PayPal request failed; reconcile uncertain outcomes before retry");
  return r.json();
 }
 function checkSelection(s){
  if(s?.paypalEnvironment!=="production"||s?.fulfillment!=="APPROVED_LICENSE_REQUIRED"||!s?.termsVersion?.startsWith("BRUA1-LEGAL-APPROVED-"))throw Error("Approved production selection required");
 }
 function checkOrderId(id){if(!ID.test(id||""))throw Error("Invalid provider order ID");}
 function checkOrder(o,id,s){
  const p=o?.purchase_units;
  if(o?.id!==id||!Array.isArray(p)||p.length!==1||p[0].custom_id!==s.customId||
    p[0].payee?.merchant_id!==env.PAYPAL_MERCHANT_ID||p[0].amount?.currency_code!=="USD"||
    p[0].amount?.value!==(s.priceCents/100).toFixed(2))throw Error("Provider order does not match approved selection");
 }
 return Object.freeze({
  async create(selection,requestId,accepted){
   checkSelection(selection);
   if(accepted!==true)throw Error("Recorded agreement and publishing acceptance required");
   const body=makePayPalOrderRequest(selection,"https://brua1.com");
   // Return to the existing static storefront, in the same browser session.
   body.payment_source.paypal.experience_context.return_url="https://brua1.com/instrumentals.html?checkout=return";
   body.payment_source.paypal.experience_context.cancel_url="https://brua1.com/instrumentals.html?checkout=cancel";
   const o=await request("/v2/checkout/orders","POST",body,requestId);
   checkOrderId(o.id);checkOrder(o,o.id,selection);
   const approval=o.links?.find(x=>x.rel==="payer-action"||x.rel==="approve")?.href;
   return {orderId:o.id,approve:validatePayPalApprovalLink(approval,"production")};
  },
  async reconcile(orderId,selection){
   checkOrderId(orderId);checkSelection(selection);
   const o=await request("/v2/checkout/orders/"+orderId);
   checkOrder(o,orderId,selection);
   if(o.status!=="COMPLETED")return {completed:false,status:o.status};
   return {completed:true,payment:verifyCompletedPayPalOrder({providerOrder:o,selection,expectedOrderId:orderId,merchantId:env.PAYPAL_MERCHANT_ID})};
  },
  async capture(orderId,selection,requestId,durableCaptureClaim){
   checkOrderId(orderId);checkSelection(selection);
   if(durableCaptureClaim!==true)throw Error("Atomic capture claim required");
   const prior=await request("/v2/checkout/orders/"+orderId);
   checkOrder(prior,orderId,selection);
   if(prior.status==="COMPLETED")return verifyCompletedPayPalOrder({providerOrder:prior,selection,expectedOrderId:orderId,merchantId:env.PAYPAL_MERCHANT_ID});
   if(prior.status!=="APPROVED")throw Error("Buyer approval not verified");
   await request("/v2/checkout/orders/"+orderId+"/capture","POST",{},requestId);
   const after=await request("/v2/checkout/orders/"+orderId);
   return verifyCompletedPayPalOrder({providerOrder:after,selection,expectedOrderId:orderId,merchantId:env.PAYPAL_MERCHANT_ID});
  }
 });
}
