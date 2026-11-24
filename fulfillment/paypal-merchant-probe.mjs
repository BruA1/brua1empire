// Verify the default receiving merchant from a real, unapproved PayPal order.
// No payer, no approval URL returned, no authorization, capture or refund.
// Owner's screenshot is represented by a digest, not a public merchant ID.
import {sha256} from "./production-checkout-service.mjs";
const EXPECTED="dc8309ee2fff611c8cc13f4afed5df549d27cc31927b8c245db53c061a7b3d2b";
const BASE="https://api-m.paypal.com";
export async function verifyLiveMerchant(env,requestId,transport=fetch,expected=EXPECTED){
 if(env.PAYPAL_ENVIRONMENT!=="live"||env.LIVE_CHECKOUT_ENABLED!=="false"||env.CHECKOUT_ROUTES_ENABLED!=="false"||env.REAL_AUDIO_DELIVERY_ENABLED!=="false"||env.LICENSE_ISSUANCE_ENABLED!=="false")throw Error("Lock required");
 const auth=await transport(BASE+"/v1/oauth2/token",{method:"POST",headers:{Authorization:"Basic "+btoa(env.PAYPAL_CLIENT_ID+":"+env.PAYPAL_CLIENT_SECRET),"Content-Type":"application/x-www-form-urlencoded"},body:"grant_type=client_credentials"});
 if(!auth.ok)throw Error("OAuth failed");
 const {access_token}=await auth.json();if(!access_token)throw Error("Missing token");
 const headers={Authorization:"Bearer "+access_token,"Content-Type":"application/json",Prefer:"return=representation"};
 // Default payee is supplied by PayPal, never explicitly selected by this probe.
 const created=await transport(BASE+"/v2/checkout/orders",{method:"POST",headers:{...headers,"PayPal-Request-Id":requestId},body:JSON.stringify({intent:"CAPTURE",purchase_units:[{description:"BruA1 merchant verification only - NOT FOR PAYMENT",amount:{currency_code:"USD",value:"29.99"}}]})});
 if(!created.ok)throw Error("Order creation failed");
 const order=await created.json();if(!/^[A-Z0-9]{10,30}$/.test(order.id||""))throw Error("Invalid order");
 const checked=await transport(BASE+"/v2/checkout/orders/"+order.id,{headers});if(!checked.ok)throw Error("Order readback failed");
 const read=await checked.json();
 const p=read.purchase_units?.[0],merchant=p?.payee?.merchant_id;
 if(read.id!==order.id||!["CREATED","PAYER_ACTION_REQUIRED"].includes(read.status)||read.purchase_units?.length!==1||p?.payments?.captures?.length||p?.payments?.authorizations?.length||p.amount?.currency_code!=="USD"||p.amount?.value!=="29.99"||!/^[2-9A-HJ-NP-Z]{13}$/.test(merchant||"")||await sha256(merchant)!==expected)throw Error("Merchant mismatch or unexpected order state");
 return {verified:true,merchantId:merchant,orderCreated:true,paymentCaptured:false,paymentsEnabled:false};
}
