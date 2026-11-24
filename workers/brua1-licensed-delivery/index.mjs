// BruA1 isolated license-delivery Worker. No live routes or payment capture.
// Deployment defaults OFF. Enabling requires separately audited production D1,
// private R2, verified LIVE PayPal, final buyer license and explicit CEO signoff.
import {authorizePaidDownload,productionConfigFromEnv,productionDeliveryEnabled} from "../../fulfillment/secure-issuance.mjs";
import {streamLicensedAudio} from "../../fulfillment/private-delivery.mjs";

const JSON_HEADERS=Object.freeze({"Cache-Control":"private, no-store",
 "Content-Security-Policy":"default-src 'none'; frame-ancestors 'none'",
 "X-Content-Type-Options":"nosniff","Referrer-Policy":"no-referrer","X-Frame-Options":"DENY"});
const result=(status,body)=>Response.json(body,{status,headers:JSON_HEADERS});
const sameSecret=(given,expected)=>{
 if(typeof given!=="string"||typeof expected!=="string"||!expected)return false;
 const a=new TextEncoder().encode(given),b=new TextEncoder().encode(expected);
 let bit=a.length^b.length;
 for(let i=0;i<Math.max(a.length,b.length);i++)bit|=(a[i]||0)^(b[i]||0);
 return bit===0;
};
async function readBody(request){
 const size=Number(request.headers.get("Content-Length")||0);
 if(!Number.isFinite(size)||size>512)return null;
 const text=await request.text();
 if(text.length>512)return null;
 try{const x=JSON.parse(text);return x&&typeof x==="object"&&!Array.isArray(x)?x:null;}
 catch{return null;}
}
function fromTrustedOrigin(response,origin,config){
 if(origin!==config.allowed_origin)return response;
 const h=new Headers(response.headers);
 h.set("Access-Control-Allow-Origin",origin);
 h.set("Vary","Origin");
 h.set("Access-Control-Expose-Headers","Content-Disposition");
 return new Response(response.body,{status:response.status,headers:h});
}
export default {
 async fetch(request,env){
  const url=new URL(request.url),path=url.pathname;
  const config=productionConfigFromEnv(env);
  const ready=productionDeliveryEnabled(env,config);
  if(path==="/health"&&request.method==="GET")
   return result(200,{service:"brua1-licensed-delivery",mode:"staging-default-off",
    livePayments:false,deliveryEnabled:ready,privateMastersExposed:false});
  if(!["/api/grants","/api/download"].includes(path))return result(404,{error:"Not found"});
  if(url.protocol!=="https:")return result(403,{error:"HTTPS required"});
  // Gate before looking at request bodies, credentials, stored orders or R2.
  if(!ready)return result(503,{error:"Licensed fulfillment is disabled pending final approvals"});
  const origin=request.headers.get("Origin");
  if(request.method==="OPTIONS"&&path==="/api/download"){
    if(origin!==config.allowed_origin)return result(403,{error:"Invalid origin"});
    return new Response(null,{status:204,headers:{
      "Access-Control-Allow-Origin":origin,
      "Access-Control-Allow-Methods":"POST, OPTIONS",
      "Access-Control-Allow-Headers":"Authorization, Content-Type",
      "Access-Control-Max-Age":"300","Vary":"Origin","Cache-Control":"no-store"
    }});
  }
  if(request.method!=="POST")return result(405,{error:"Method not allowed"});
  if(path==="/api/download"){
    if(origin&&origin!==config.allowed_origin)return result(403,{error:"Invalid origin"});
    // Buyer downloads use only short-lived SHA-256-hashed tokens, not internal key.
    const response=await streamLicensedAudio({request,env,config});
    return fromTrustedOrigin(response,origin,config);
  }
  // Issuing a grant is INTERNAL ONLY. A browser must never be able to ask this
  // endpoint to mint a token simply by knowing a PayPal order ID.
  if(origin)return result(403,{error:"Service request cannot be browser initiated"});
  const supplied=request.headers.get("X-BruA1-Service-Key");
  if(!sameSecret(supplied,env.INTERNAL_FULFILLMENT_KEY))
    return result(401,{error:"Not authorized"});
  const body=await readBody(request);
  if(!body)return result(400,{error:"Invalid request body"});
  try{
    const grant=await authorizePaidDownload({env,orderId:body.orderId,format:body.format,config});
    return Response.json({granted:true,productId:grant.product_id,tier:grant.tier,
      format:grant.format,token:grant.token,
      expiresAtEpoch:grant.expires_at_epoch,maxDownloads:grant.max_downloads},
      {status:200,headers:JSON_HEADERS});
  }catch{
    // Avoid leaking customer identity, bucket object key, payment details or legal data.
    return result(409,{error:"No verified licensed entitlement available"});
  }
 }
};
