// Provision only non-enrollable recurring plans, no subscriber or charge.
const BASE="https://api-m.paypal.com";
const PRODUCT_NAME="BruA1 Music Network";
const productIdValid=id=>typeof id==="string"&&/^PROD-[A-Z0-9]{17}$/.test(id);
const NAME="BruA1 Music Network";
export const PLANS=Object.freeze([{key:"monthly",name:"BruA1 Music Network Monthly V1",amount:"4.99",unit:"MONTH"},{key:"annual",name:"BruA1 Music Network Annual V1",amount:"49.99",unit:"YEAR"}]);
export function verifyPlan(plan,spec,productId=plan.product_id){
 const c=plan.billing_cycles?.[0],p=plan.payment_preferences;
 if(!/^P-[A-Z0-9]{24}$/.test(plan.id||"")||!productIdValid(productId)||plan.product_id!==productId||plan.name!==spec.name||!["CREATED","INACTIVE"].includes(plan.status)||plan.billing_cycles.length!==1||c.tenure_type!=="REGULAR"||c.sequence!==1||c.total_cycles!==0||c.frequency?.interval_unit!==spec.unit||c.frequency?.interval_count!==1||c.pricing_scheme?.fixed_price?.currency_code!=="USD"||Number(c.pricing_scheme?.fixed_price?.value)!==Number(spec.amount)||p?.auto_bill_outstanding!==false||p?.payment_failure_threshold!==1||Number(p?.setup_fee?.value||0)!==0||plan.quantity_supported===true)throw Error("Plan does not match locked specification");
 return true;
}
export async function provisionNetworkPlans(env,transport=fetch){
 if(env.PAYPAL_ENVIRONMENT!=="live"||env.LIVE_CHECKOUT_ENABLED!=="false"||env.CHECKOUT_ROUTES_ENABLED!=="false"||env.NETWORK_SUBSCRIPTION_ENROLLMENT_ENABLED!=="false"||!env.PAYPAL_CLIENT_ID||!env.PAYPAL_CLIENT_SECRET)throw Error("Prelaunch lock required");
 const auth=await transport(BASE+"/v1/oauth2/token",{method:"POST",headers:{Authorization:"Basic "+btoa(env.PAYPAL_CLIENT_ID+":"+env.PAYPAL_CLIENT_SECRET),"Content-Type":"application/x-www-form-urlencoded"},body:"grant_type=client_credentials"});
 if(!auth.ok)throw Error("OAuth failed");
 const token=(await auth.json()).access_token;if(!token)throw Error("No token");
 async function request(path,{method="GET",body,requestId,allow404=false}={}){
  const r=await transport(BASE+path,{method,headers:{Authorization:"Bearer "+token,Accept:"application/json","Content-Type":"application/json",Prefer:"return=representation",...(requestId?{"PayPal-Request-Id":requestId}:{})},...(body?{body:JSON.stringify(body)}:{})});
  if(allow404&&r.status===404)return null;
  if(!r.ok){
   const err=await r.json().catch(()=>({}));
   const label=path.startsWith("/v1/catalogs/products")?"PRODUCT":path.startsWith("/v1/billing/plans")?(method==="POST"?"PLAN_CREATE":path.includes("?")?"PLAN_LIST":"PLAN_READ"):"OTHER";
   const safe=x=>typeof x==="string"&&/^[A-Z0-9_./-]{1,100}$/.test(x)?x:"UNKNOWN";
   const detail=(err.details||[]).slice(0,3).map(d=>safe(d.issue)+":"+safe(d.field)).join(",");
   throw Error("NETWORK_PAYPAL_"+label+"_"+r.status+"_"+safe(err.name)+(detail?"_"+detail:""));
  }
  return r.json();
 }
 // PayPal reserves PROD- for its own generated identifiers. Discover exact
 // existing product first, then let PayPal generate its ID on creation.
 const matched=[];
 for(let page=1;page<=100;page++){
  const list=await request("/v1/catalogs/products?page_size=20&page="+page+"&total_required=true");
  if(!Array.isArray(list.products))throw Error("Product list missing");
  matched.push(...list.products.filter(p=>p.name===PRODUCT_NAME));
  if(!list.links?.some(l=>l.rel==="next")&&!(list.total_pages>page))break;
  if(page===100)throw Error("Product list too large");
 }
 if(matched.length>1)throw Error("Duplicate product names; manual review required");
 let id=matched[0]?.id;
 if(!id){
  const created=await request("/v1/catalogs/products",{method:"POST",requestId:"brua1-network-generated-product-v2",body:{name:NAME,type:"SERVICE",description:"Membership access to music industry directory and online community."}});
  id=created.id;
 }
 if(!productIdValid(id))throw Error("Invalid PayPal-generated product ID");
 const product=await request("/v1/catalogs/products/"+id);
 if(product.id!==id||product.name!==NAME||product.type!=="SERVICE")throw Error("Product mismatch");
 const PRODUCT=id;
 const listed=await request("/v1/billing/plans?product_id="+PRODUCT+"&page_size=20&page=1&total_required=true");
 if(!Array.isArray(listed.plans)||listed.total_pages>1||listed.links?.some(l=>l.rel==="next"))throw Error("Unexpected plan list");
 const results=[];
 for(const spec of PLANS){
  const matches=listed.plans.filter(p=>p.name===spec.name);
  if(matches.length>1)throw Error("Duplicate plan; manual review required");
  let id=matches[0]?.id;
  if(!id){
   const created=await request("/v1/billing/plans",{method:"POST",requestId:"brua1-network-"+spec.key+"-v1",body:{product_id:PRODUCT,name:spec.name,status:"CREATED",description:"Recurring membership; enrollment not yet open.",billing_cycles:[{frequency:{interval_unit:spec.unit,interval_count:1},tenure_type:"REGULAR",sequence:1,total_cycles:0,pricing_scheme:{fixed_price:{currency_code:"USD",value:spec.amount}}}],payment_preferences:{auto_bill_outstanding:false,setup_fee:{currency_code:"USD",value:"0.00"},setup_fee_failure_action:"CANCEL",payment_failure_threshold:1},quantity_supported:false}});
   id=created.id;
  }
  if(!/^P-[A-Z0-9]{24}$/.test(id||""))throw Error("Invalid plan ID");
  const read=await request("/v1/billing/plans/"+id);verifyPlan(read,spec,PRODUCT);
  results.push({key:spec.key,id,status:read.status,amount:spec.amount,unit:spec.unit});
 }
 return {verified:true,productId:PRODUCT,plans:results,enrollmentEnabled:false,chargesCreated:false};
}
