import {PLANS,verifyPlan} from "./network-paypal-plans.mjs";
const BASE="https://api-m.paypal.com",RETURN="https://brua1.com/music-network.html";
const planRE=/^P-[A-Z0-9]{24}$/,subRE=/^I-[A-Z0-9]{8,32}$/,uuidRE=/^[a-f0-9-]{36}$/;
export async function networkProviderOperation(env,action,x,transport=fetch){
 if(env.PAYPAL_ENVIRONMENT!=="live"||env.NETWORK_SUBSCRIPTION_ENROLLMENT_ENABLED!=="true"||!env.PAYPAL_CLIENT_ID||!env.PAYPAL_CLIENT_SECRET)throw Error("Billing closed");
 const a=await transport(BASE+"/v1/oauth2/token",{method:"POST",headers:{Authorization:"Basic "+btoa(env.PAYPAL_CLIENT_ID+":"+env.PAYPAL_CLIENT_SECRET),"Content-Type":"application/x-www-form-urlencoded"},body:"grant_type=client_credentials"});
 if(!a.ok)throw Error("Provider authentication failed");
 const token=(await a.json()).access_token;if(!token)throw Error("Provider authentication failed");
 async function call(path,method="GET",body,id){
  const r=await transport(BASE+path,{method,headers:{Authorization:"Bearer "+token,Accept:"application/json","Content-Type":"application/json",Prefer:"return=representation",...(id?{"PayPal-Request-Id":id}:{})},...(body?{body:JSON.stringify(body)}:{})});
  if(!r.ok)throw Error("Provider unavailable");
  return r.status===204?{}:r.json();
 }
 if(action==="create"){
  if(!planRE.test(x.planId||"")||!uuidRE.test(x.customId||"")||!uuidRE.test(x.requestId||""))throw Error("Invalid binding");
  const p=await call("/v1/billing/plans/"+x.planId),spec=PLANS.find(s=>s.name===p.name);
  if(!spec||p.id!==x.planId)throw Error("Unknown plan");
  verifyPlan(p,spec,p.product_id,["ACTIVE"]);
  const product=await call("/v1/catalogs/products/"+p.product_id);
  if(product.id!==p.product_id||product.name!=="BruA1 Music Network"||product.type!=="SERVICE")throw Error("Wrong product");
  const s=await call("/v1/billing/subscriptions","POST",{plan_id:x.planId,custom_id:x.customId,quantity:"1",application_context:{brand_name:"BruA1 Music Network",shipping_preference:"NO_SHIPPING",user_action:"SUBSCRIBE_NOW",payment_method:{payee_preferred:"IMMEDIATE_PAYMENT_REQUIRED"},return_url:RETURN+"?subscription=return",cancel_url:RETURN+"?subscription=cancel"}},x.requestId);
  return {id:s.id,plan_id:s.plan_id,custom_id:s.custom_id,status:s.status,links:s.links?.filter(l=>l.rel==="approve")};
 }
 if(!subRE.test(x.subscriptionId||""))throw Error("Invalid subscription");
 const path="/v1/billing/subscriptions/"+x.subscriptionId,s=await call(path);
 if(s.id!==x.subscriptionId||s.plan_id!==x.planId||s.custom_id!==x.customId||s.plan_overridden===true||String(s.quantity??"1")!=="1")throw Error("Wrong subscription");
 if(action==="cancel"){
  if(!["CANCELLED","EXPIRED"].includes(s.status))await call(path+"/cancel","POST",{reason:"Member requested cancellation"});
  return {cancellationRequested:true};
 }
 if(action!=="read")throw Error("Unsupported operation");
 const subscription={id:s.id,plan_id:s.plan_id,custom_id:s.custom_id,status:s.status,plan_overridden:s.plan_overridden,quantity:s.quantity,billing_info:s.billing_info};
 const last=Date.parse(s.billing_info?.last_payment?.time);
 if(!Number.isFinite(last))return {subscription,transactions:[]};
 const end=Math.min(Date.now(),last+86400000);
 if(end<last)throw Error("Future payment");
 const tx=await call(path+"/transactions?start_time="+encodeURIComponent(new Date(last-86400000).toISOString())+"&end_time="+encodeURIComponent(new Date(end).toISOString()));
 if(!Array.isArray(tx.transactions)||tx.total_pages>1||tx.links?.some(l=>l.rel==="next"))throw Error("Incomplete transaction list");
 return {subscription,transactions:tx.transactions.map(t=>({id:t.id,status:t.status,time:t.time,amount_with_breakdown:{gross_amount:t.amount_with_breakdown?.gross_amount}}))};
}
