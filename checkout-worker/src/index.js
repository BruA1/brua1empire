// BruA1 PayPal Sandbox checkout API. Development only; no file fulfillment.
// Deploy as a separate Worker with PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET
// configured as RUNTIME bindings, never build-time injected assets.
const PRICES = Object.freeze({basic:"29.99",premium:"59.99",unlimited:"99.99"});
const JSON_HEADERS = {"content-type":"application/json; charset=utf-8","cache-control":"no-store"};
const respond = (data,status=200)=>new Response(JSON.stringify(data),{status,headers:JSON_HEADERS});
function assertSandbox(env) {
  if(env.PAYPAL_ENVIRONMENT!=="sandbox") throw new Error("Sandbox-only checkout");
  if(!env.PAYPAL_CLIENT_ID||!env.PAYPAL_CLIENT_SECRET) throw new Error("Runtime PayPal credentials not configured");
}
async function accessToken(env) {
  const auth=btoa(env.PAYPAL_CLIENT_ID+":"+env.PAYPAL_CLIENT_SECRET);
  const r=await fetch("https://api-m.sandbox.paypal.com/v1/oauth2/token",{
    method:"POST",headers:{authorization:"Basic "+auth,"content-type":"application/x-www-form-urlencoded"},
    body:"grant_type=client_credentials"});
  if(!r.ok) throw new Error("PayPal authentication failed");
  const data=await r.json();return data.access_token;
}
async function paypal(env,endpoint,method,body,requestId) {
  const token=await accessToken(env);
  const headers={authorization:"Bearer "+token,"content-type":"application/json","prefer":"return=representation"};
  if(requestId) headers["PayPal-Request-Id"]=requestId;
  const r=await fetch("https://api-m.sandbox.paypal.com"+endpoint,{method,headers,body:body?JSON.stringify(body):undefined});
  const result=await r.json().catch(()=>({}));
  if(!r.ok) throw new Error("PayPal request failed: "+r.status);
  return result;
}
export default {async fetch(request,env) {
  const url=new URL(request.url);
  if(url.pathname==="/health"&&request.method==="GET") return respond({service:"BruA1 sandbox checkout",mode:"sandbox",checkout:"disabled until catalog and fulfillment review"});
  if(!url.pathname.startsWith("/api/")) return respond({error:"Not found"},404);
  // Security gate remains closed until persistence, verified track IDs,
  // license agreements, fulfillment, CORS and deployment review are complete.
  return respond({error:"Sandbox checkout is not enabled yet"},503);
}};
