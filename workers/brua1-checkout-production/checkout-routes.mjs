import {buyerGrants,buyerDownload} from "../../fulfillment/buyer-delivery.mjs";
// Production API adapter. All purchase routes are fail-closed until release.
import {createCheckoutService,productionCheckoutReady,receiveVerifiedWebhook} from "../../fulfillment/production-checkout-service.mjs";
const SITE="https://brua1.com";
const PATHS=new Map([["/api/checkout/offer","offer"],["/api/checkout/begin","begin"],["/api/create-order","create"],["/api/capture-order","capture"],["/api/checkout/create-order","create"],["/api/checkout/capture-order","capture"]]);
const headers={"Cache-Control":"no-store","Content-Type":"application/json; charset=utf-8","X-Content-Type-Options":"nosniff","Referrer-Policy":"no-referrer","Content-Security-Policy":"default-src 'none'; frame-ancestors 'none'"};
const reply=(status,data,cors=false)=>new Response(JSON.stringify(data),{status,headers:{...headers,...(cors?{"Access-Control-Allow-Origin":SITE,"Vary":"Origin"}:{})}});
async function body(request,limit){
 if(!request.headers.get("Content-Type")?.toLowerCase().startsWith("application/json"))throw Error("JSON required");
 const declared=Number(request.headers.get("Content-Length")||0);
 if(!Number.isFinite(declared)||declared>limit)throw Error("Request too large");
 const reader=request.body?.getReader();if(!reader)throw Error("JSON required");
 let total=0;const chunks=[];
 for(;;){const {value,done}=await reader.read();if(done)break;total+=value.length;if(total>limit){await reader.cancel();throw Error("Request too large");}chunks.push(value);}
 const bytes=new Uint8Array(total);let offset=0;for(const c of chunks){bytes.set(c,offset);offset+=c.length;}
 const obj=JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(bytes));
 if(!obj||typeof obj!=="object"||Array.isArray(obj))throw Error("JSON object required");
 return obj;
}
export async function checkoutRoute(request,env,{transport=fetch,serviceFactory=createCheckoutService,webhook=receiveVerifiedWebhook}={}){
 const url=new URL(request.url),origin=request.headers.get("Origin"),cors=origin===SITE;
 if(!PATHS.has(url.pathname)&&!["/api/paypal/webhook","/api/checkout/grants","/api/checkout/download"].includes(url.pathname))return null;
 if(url.protocol!=="https:")return reply(403,{error:"HTTPS required"});
 // This additional gate remains false until the buyer receipt/download path
 // and webhook reconciliation (not just inbox persistence) are operational.
 if(url.pathname==="/api/paypal/webhook"&&env.PAYPAL_WEBHOOK_ID&&env.WEBHOOK_INBOX_ENABLED==="true"){
  if(request.method!=="POST"||origin)return reply(405,{error:"Webhook POST required"});
  try{const event=await body(request,131072);await webhook(env,request.headers,event,transport);return reply(200,{accepted:true});}
  catch{return reply(400,{error:"Webhook not accepted"});}
 }
 if(!productionCheckoutReady(env)||env.BUYER_DELIVERY_ROUTE_VERIFIED!=="true"||env.WEBHOOK_RECONCILIATION_VERIFIED!=="true")return reply(503,{error:"BruA1 live checkout is not yet enabled."},cors);
 if(url.pathname==="/api/paypal/webhook")return reply(503,{error:"Webhook inbox not configured"});
 if(!cors)return reply(403,{error:"Origin not allowed"});
 if(request.method==="OPTIONS")return new Response(null,{status:204,headers:{...headers,"Access-Control-Allow-Origin":SITE,"Access-Control-Allow-Methods":"POST, OPTIONS","Access-Control-Allow-Headers":"Content-Type, Authorization","Vary":"Origin"}});
 if(request.method!=="POST")return reply(405,{error:"POST required"},true);
 if(url.pathname==="/api/checkout/download"){
  const response=await buyerDownload(env,request);
  const h=new Headers(response.headers);h.set("Access-Control-Allow-Origin",SITE);h.set("Vary","Origin");h.set("Access-Control-Expose-Headers","Content-Disposition");
  return new Response(response.body,{status:response.status,headers:h});
 }
 try{const input=await body(request,8192);
  if(url.pathname==="/api/checkout/grants")return reply(200,await buyerGrants(env,input,transport),true);
  const service=serviceFactory(env,{transport});const authorization=request.headers.get("Authorization");const memberToken=authorization?.startsWith("Bearer ")?authorization.slice(7):undefined;const result=await service[PATHS.get(url.pathname)](input,{memberToken});return reply(200,result,true);}
 catch{return reply(409,{error:"Checkout unavailable or requires reconciliation. Contact support with your order number if charged."},true);}
}
