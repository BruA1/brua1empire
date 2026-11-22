// BruA1 PayPal Sandbox API — not wired into production until reviewed.
// Routes: POST /api/paypal/create-order and POST /api/paypal/capture-order.
// Never expose PAYPAL_CLIENT_SECRET to browser clients.
const prices = Object.freeze({basic:"29.99",premium:"59.99",unlimited:"99.99"});
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store","x-content-type-options":"nosniff"}});
async function paypalToken(env){
  if(env.PAYPAL_ENVIRONMENT!=="sandbox")throw new Error("Sandbox environment required");
  if(!env.PAYPAL_CLIENT_ID||!env.PAYPAL_CLIENT_SECRET)throw new Error("PayPal credentials missing");
  const auth=btoa(env.PAYPAL_CLIENT_ID+":"+env.PAYPAL_CLIENT_SECRET);
  const res=await fetch("https://api-m.sandbox.paypal.com/v1/oauth2/token",{method:"POST",headers:{Authorization:"Basic "+auth,"content-type":"application/x-www-form-urlencoded"},body:"grant_type=client_credentials"});
  if(!res.ok)throw new Error("PayPal authentication failed");
  const data=await res.json();return data.access_token;
}
async function paypalRequest(env,token,path,body,requestId){
  const res=await fetch("https://api-m.sandbox.paypal.com"+path,{method:"POST",headers:{Authorization:"Bearer "+token,"content-type":"application/json","PayPal-Request-Id":requestId},body:body?JSON.stringify(body):undefined});
  const data=await res.json().catch(()=>({}));
  if(!res.ok)throw new Error("PayPal request failed: "+res.status);
  return data;
}
export async function handlePayPal(request,env){
  const url=new URL(request.url);
  if(!url.pathname.startsWith("/api/paypal/"))return null;
  if(request.method!=="POST")return json({error:"Method not allowed"},405);
  if(env.PAYPAL_ENVIRONMENT!=="sandbox")return json({error:"Checkout not enabled"},503);
  // Only same-origin browser calls; server-to-server integrations need separate authentication.
  if(request.headers.get("origin")!==url.origin)return json({error:"Origin not allowed"},403);
  if(Number(request.headers.get("content-length")||0)>4096)return json({error:"Request too large"},413);
  let input;try{input=await request.json()}catch{return json({error:"Invalid JSON"},400)}
  try{
    const token=await paypalToken(env);
    if(url.pathname==="/api/paypal/create-order"){
      const {trackId,license}=input||{};
      // Deliberately no arbitrary client-supplied prices or track titles.
      // Catalog allowlist must be independently verified before enabling this route.
      if(!env.BRUA1_VERIFIED_CATALOG)return json({error:"Catalog verification pending"},503);
      const catalog=JSON.parse(env.BRUA1_VERIFIED_CATALOG);
      if(typeof trackId!=="string"||!Object.hasOwn(catalog,trackId)||!Object.hasOwn(prices,license))return json({error:"Invalid selection"},400);
      const order=await paypalRequest(env,token,"/v2/checkout/orders",{
        intent:"CAPTURE",purchase_units:[{reference_id:trackId,custom_id:trackId+":"+license,
          amount:{currency_code:"USD",value:prices[license]},
          description:"BruA1 "+license+" instrumental license"}]
      },crypto.randomUUID());
      return json({id:order.id,status:order.status});
    }
    if(url.pathname==="/api/paypal/capture-order"){
      // Capture endpoint is intentionally locked until order-to-license reconciliation,
      // persistent idempotency, fulfillment records and delivery authorization exist.
      return json({error:"Capture disabled pending fulfillment verification"},503);
    }
    return json({error:"Not found"},404);
  }catch(e){return json({error:"Payment service temporarily unavailable"},502)}
}
