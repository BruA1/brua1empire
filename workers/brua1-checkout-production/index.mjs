import {provisionNetworkPlans} from "../../fulfillment/network-paypal-plans.mjs";
import {auditPrivateAudio} from "../../fulfillment/audit-private-audio.mjs";
import {verifyLiveMerchant} from "../../fulfillment/paypal-merchant-probe.mjs";
import {seedPrivateAssets} from "../../fulfillment/seed-private-assets.mjs";
import {provisionWebhook} from "../../fulfillment/paypal-webhook-provision.mjs";
import {checkoutRoute} from "./checkout-routes.mjs";
import {probeStorage} from "../../fulfillment/storage-probe.mjs";
/**
 * BruA1 dedicated LIVE PayPal checkout identity holder — PRELAUNCH LOCK.
 *
 * This Worker has gated payment routes; deployed prelaunch flags prevent real-money payments or delivery.
 * It is separate from the operational brua1-checkout-sandbox Worker.
 * Live credentials must ONLY be entered through Cloudflare encrypted Worker
 * secrets; never GitHub repository contents or a browser chat.
 *
 * This remains a prelaunch deployment, NOT an active checkout release.
 */
const DEFAULT_HEADERS = Object.freeze({
  "Cache-Control":"no-store",
  "Content-Type":"application/json; charset=utf-8",
  "X-Content-Type-Options":"nosniff",
  "Referrer-Policy":"no-referrer",
  "X-Frame-Options":"DENY",
  "Content-Security-Policy":"default-src 'none'; frame-ancestors 'none'",
});
function respond(status,data) {
  return new Response(JSON.stringify(data),{status,headers:DEFAULT_HEADERS});
}

// Owner-authorized, read-only LIVE OAuth test. Does NOT create or capture orders.
// Access requires a random ephemeral one-time test secret, installed and removed
// by a QA-gated deployment workflow. The time component expires after 10 minutes.
// No credentials, access token or PayPal raw responses are written to logs/HTTP.
const OAUTH_URL="https://api-m.paypal.com/v1/oauth2/token";
const VERIFY_WINDOW_MS=10*60*1000;
const candidateFormat=/^[0-9]{13}\.[a-f0-9]{64}$/;
function secureCompare(a,b){
 if(typeof a!=="string"||typeof b!=="string")return false;
 const x=new TextEncoder().encode(a),y=new TextEncoder().encode(b);
 let diff=x.length^y.length;
 for(let i=0;i<Math.max(x.length,y.length);i++)diff|=(x[i]||0)^(y[i]||0);
 return diff===0;
}
function verifyNonce(expected,provided,now=Date.now()){
 if(!candidateFormat.test(expected||"")||!candidateFormat.test(provided||""))return false;
 const stamp=Number(expected.slice(0,13));
 if(!Number.isSafeInteger(stamp)||stamp>now||now-stamp>VERIFY_WINDOW_MS)return false;
 return secureCompare(provided,expected);
}
export async function paypalLiveAuthProbe(env,transport){
 if(env?.PAYPAL_ENVIRONMENT!=="live"||
    env?.LIVE_CHECKOUT_ENABLED!=="false"||
    env?.LICENSE_ISSUANCE_ENABLED!=="false"||
    env?.REAL_AUDIO_DELIVERY_ENABLED!=="false")
   return {verified:false,code:"PRELAUNCH_GATE_NOT_LOCKED",httpStatus:503};
 if(typeof env?.PAYPAL_CLIENT_ID!=="string"||!env.PAYPAL_CLIENT_ID.trim()||
    typeof env?.PAYPAL_CLIENT_SECRET!=="string"||!env.PAYPAL_CLIENT_SECRET.trim())
   return {verified:false,code:"LIVE_CREDENTIAL_MISSING",httpStatus:503};
 let authorization;
 try{
   authorization="Basic "+btoa(env.PAYPAL_CLIENT_ID+":"+env.PAYPAL_CLIENT_SECRET);
 }catch{
   return {verified:false,code:"PAYPAL_CREDENTIAL_ENCODING_ERROR",httpStatus:502};
 }
 let response;
 try{
   // Match the minimal request pattern already proven in our PayPal Sandbox
   // Worker. The global fetch function is invoked in its request context.
   const doFetch=transport??((url,options)=>fetch(url,options));
   response=await doFetch(OAUTH_URL,{
     method:"POST",
     headers:{
       Authorization:authorization,
       "Content-Type":"application/x-www-form-urlencoded"
     },
     body:"grant_type=client_credentials"
   });
 }catch{
   return {verified:false,code:"PAYPAL_NETWORK_OR_TLS_ERROR",httpStatus:502};
 }
 if(response.status===401||response.status===403)
   return {verified:false,code:"PAYPAL_REJECTED_CREDENTIALS",httpStatus:502};
 if(!response.ok)
   return {verified:false,code:"PAYPAL_OAUTH_UNAVAILABLE",httpStatus:502};
 // Never return or persist PayPal's token. Only a non-sensitive yes/no.
 let payload;
 try{payload=await response.json();}
 catch{
   return {verified:false,code:"PAYPAL_RESPONSE_NOT_JSON",httpStatus:502};
 }
 if(typeof payload?.access_token!=="string"||!payload.access_token||
    typeof payload.token_type!=="string"||payload.token_type.toLowerCase()!=="bearer"||
    !Number.isFinite(Number(payload.expires_in))||Number(payload.expires_in)<=0)
   return {verified:false,code:"PAYPAL_OAUTH_INVALID_RESPONSE",httpStatus:502};
 return {verified:true,code:"PAYPAL_LIVE_OAUTH_ACCEPTED",httpStatus:200};
}

export default {
  async fetch(request,env) {
    const url = new URL(request.url);
    if(url.pathname==="/internal/verify-storage")return probeStorage(request,env,false);
    if(url.pathname==="/internal/verify-live-oauth"){
      if(request.method!=="POST")return respond(405,{verified:false,code:"METHOD_NOT_ALLOWED"});
      const header=request.headers.get("Authorization")||"";
      const bearer=header.startsWith("Bearer ")?header.slice(7):"";
      if(!verifyNonce(env?.PAYPAL_VERIFY_NONCE,bearer))
        return respond(401,{verified:false,code:"NOT_AUTHORIZED"});
      const report=await paypalLiveAuthProbe(env);
      // No PayPal token, client ID, client secret, buyer identity or merchant
      // details ever appear in this response.
      return respond(report.httpStatus,{verified:report.verified,code:report.code,
        check:"paypal-live-oauth",paymentsEnabled:false});
    }
    if(url.pathname==="/internal/audit-private-audio"){
      if(request.method!=="POST")return respond(405,{verified:false});
      const bearer=(request.headers.get("Authorization")||"").replace(/^Bearer /,"");
      if(!verifyNonce(env.PAYPAL_VERIFY_NONCE,bearer))return respond(401,{verified:false,code:"NOT_AUTHORIZED"});
      try{return respond(200,await auditPrivateAudio(env));}
      catch{return respond(502,{verified:false,code:"PRIVATE_AUDIO_AUDIT_FAILED"});}
    }
    if(url.pathname==="/internal/seed-private-assets"){
      if(request.method!=="POST")return respond(405,{verified:false});
      const bearer=(request.headers.get("Authorization")||"").replace(/^Bearer /,"");
      if(!verifyNonce(env.PAYPAL_VERIFY_NONCE,bearer))return respond(401,{verified:false,code:"NOT_AUTHORIZED"});
      try{return respond(200,await seedPrivateAssets(env));}
      catch{return respond(502,{verified:false,code:"ASSET_MAPPING_FAILED"});}
    }
    if(url.pathname==="/internal/provision-network-plans"){
      if(request.method!=="POST")return respond(405,{verified:false});
      const bearer=(request.headers.get("Authorization")||"").replace(/^Bearer /,"");
      if(!verifyNonce(env.PAYPAL_VERIFY_NONCE,bearer))return respond(401,{verified:false,code:"NOT_AUTHORIZED"});
      try{return respond(200,await provisionNetworkPlans(env));}
      catch(e){return respond(502,{verified:false,code:/^PayPal plan operation failed: [0-9]{3}$/.test(e.message)?e.message:"NETWORK_PLAN_SETUP_FAILED"});}
    }
    if(url.pathname==="/internal/verify-live-merchant"){
      if(request.method!=="POST")return respond(405,{verified:false});
      const bearer=(request.headers.get("Authorization")||"").replace(/^Bearer /,"");
      if(!verifyNonce(env.PAYPAL_VERIFY_NONCE,bearer))return respond(401,{verified:false,code:"NOT_AUTHORIZED"});
      try{return respond(200,await verifyLiveMerchant(env,"merchant-check-"+bearer.slice(0,13)));}
      catch{return respond(502,{verified:false,code:"MERCHANT_VERIFICATION_FAILED"});}
    }
    if(url.pathname==="/internal/provision-paypal-webhook"){
      if(request.method!=="POST")return respond(405,{verified:false});
      const bearer=(request.headers.get("Authorization")||"").replace(/^Bearer /,"");
      if(!verifyNonce(env.PAYPAL_VERIFY_NONCE,bearer))return respond(401,{verified:false,code:"NOT_AUTHORIZED"});
      try{return respond(200,await provisionWebhook(env));}
      catch{return respond(502,{verified:false,code:"WEBHOOK_SETUP_FAILED"});}
    }
    if(request.method==="GET" && url.pathname==="/health") {
      return respond(200,{
        service:"brua1-checkout-production",
        status:"PRELAUNCH_LOCKED",
        livePayments:false,
        paymentCaptureEnabled:false,
        licenseIssuanceEnabled:false,
        realAudioDeliveryEnabled:false,
        sandboxUnaffected:true
      });
    }
    const routed=await checkoutRoute(request,env);
    if(routed)return routed;
    if(url.pathname.startsWith("/api/") || url.pathname.startsWith("/checkout")) {
      return respond(503,{error:"BruA1 live checkout is not yet enabled."});
    }
    return respond(404,{error:"Not found"});
  }
};
