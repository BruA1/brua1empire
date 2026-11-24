// Read-only prelaunch storage integration. Never returns database rows or R2 object keys.
const reply=(status,body)=>Response.json(body,{status,headers:{"Cache-Control":"no-store","X-Content-Type-Options":"nosniff"}});
function equal(a,b){
 if(typeof a!=="string"||typeof b!=="string"||!b)return false;
 let diff=a.length^b.length;
 for(let i=0;i<Math.max(a.length,b.length);i++)diff|=(a.charCodeAt(i)||0)^(b.charCodeAt(i)||0);
 return diff===0;
}
export async function probeStorage(request,env,delivery){
 if(request.method!=="POST")return reply(405,{error:"Method not allowed"});
 const expected=env.STORAGE_PROBE_NONCE||"",given=request.headers.get("Authorization")||"";
 const valid=/^[0-9]{13}\.[a-f0-9]{64}$/.test(expected);
 const age=Date.now()-Number(expected.slice(0,13));
 if(!valid||age<0||age>600000||!equal(given,"Bearer "+expected))return reply(401,{error:"Not authorized"});
 const locked=delivery?env.LIVE_DELIVERY_ENABLED==="false"&&env.OWNER_FINAL_GO_LIVE_SIGNOFF==="false":env.LIVE_CHECKOUT_ENABLED==="false"&&env.LICENSE_ISSUANCE_ENABLED==="false"&&env.REAL_AUDIO_DELIVERY_ENABLED==="false";
 if(!locked)return reply(503,{verified:false,code:"LOCK_REQUIRED"});
 try{
  const row=await env.ORDERS_DB.prepare("SELECT COUNT(*) AS total, SUM(CASE WHEN sale_enabled=0 THEN 1 ELSE 0 END) AS disabled FROM commerce_products").first();
  const db=Number(row?.total)===36&&Number(row?.disabled)===36;
  let r2=null;
  if(delivery){const listing=await env.INSTRUMENTAL_MASTERS.list({limit:1});r2=Array.isArray(listing.objects)&&listing.objects.length>0;}
  const verified=db&&(!delivery||r2===true);
  return reply(verified?200:503,{verified,databaseVerified:db,privateBucketReachable:r2,paymentsEnabled:false,deliveryEnabled:false});
 }catch{return reply(503,{verified:false,code:"STORAGE_UNAVAILABLE"});}
}
