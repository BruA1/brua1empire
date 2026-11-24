// Real PayPal SANDBOX test, guarded by existing checkout test key and sandbox-only environment.
// Shared membership enrollment/entitlement modules; isolated network_ tables in sandbox D1.
import {beginEnrollment,refreshEnrollment,cancelEnrollment} from "../brua1-music-network/enrollment.mjs";
import {redeemInvite} from "../brua1-music-network/auth.mjs";
import {networkRoute} from "../brua1-music-network/index.mjs";
const name="BruA1 Music Network SANDBOX QA",planName=name+" Monthly",version="SANDBOX-QA-ONLY";
const hex=b=>Array.from(b,x=>x.toString(16).padStart(2,"0")).join("");
const secret=()=>hex(crypto.getRandomValues(new Uint8Array(32)));
const hash=async x=>hex(new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(x))));
const stmt=(db,sql,...args)=>db.prepare(sql).bind(...args);
const first=(db,sql,...args)=>stmt(db,sql,...args).first();
const json=(data,status=200)=>Response.json(data,{status,headers:{"Cache-Control":"no-store","X-Content-Type-Options":"nosniff","Referrer-Policy":"no-referrer"}});
async function findProduct(paypal){
 const found=[];
 for(let page=1;page<=100;page++){const r=await paypal("/v1/catalogs/products?page_size=20&page="+page+"&total_required=true");if(!Array.isArray(r.products))throw Error("Invalid catalog response");found.push(...r.products.filter(p=>p.name===name));if(!r.links?.some(l=>l.rel==="next")&&!(r.total_pages>page))break;if(page===100)throw Error("Catalog limit");}
 if(found.length>1)throw Error("Duplicate sandbox products");
 const product=found[0]||await paypal("/v1/catalogs/products","POST",{name,type:"SERVICE",description:"SANDBOX membership test. No real money."},"brua1-network-sandbox-product-v1");
 if(!/^PROD-[A-Z0-9]{17}$/.test(product.id))throw Error("Invalid product");
 const checked=await paypal("/v1/catalogs/products/"+product.id);if(checked.name!==name||checked.type!=="SERVICE")throw Error("Wrong product");
 return product.id;
}
async function ensurePlan(paypal){
 const product=await findProduct(paypal),list=await paypal("/v1/billing/plans?product_id="+product+"&page_size=20&page=1&total_required=true");
 if(!Array.isArray(list.plans)||list.total_pages>1||list.links?.some(l=>l.rel==="next"))throw Error("Invalid plan list");
 const found=list.plans.filter(p=>p.name===planName);if(found.length>1)throw Error("Duplicate sandbox plans");
 const result=found[0]||await paypal("/v1/billing/plans","POST",{product_id:product,name:planName,status:"ACTIVE",description:"SANDBOX only, monthly test",billing_cycles:[{frequency:{interval_unit:"MONTH",interval_count:1},tenure_type:"REGULAR",sequence:1,total_cycles:0,pricing_scheme:{fixed_price:{currency_code:"USD",value:"4.99"}}}],payment_preferences:{auto_bill_outstanding:false,setup_fee:{currency_code:"USD",value:"0.00"},setup_fee_failure_action:"CANCEL",payment_failure_threshold:1},quantity_supported:false},"brua1-network-sandbox-plan-v1");
 if(!/^P-[A-Z0-9]{24}$/.test(result.id))throw Error("Invalid plan");
 const p=await paypal("/v1/billing/plans/"+result.id),c=p.billing_cycles?.[0];
 if(p.id!==result.id||p.product_id!==product||p.name!==planName||p.status!=="ACTIVE"||p.billing_cycles?.length!==1||c?.tenure_type!=="REGULAR"||c.total_cycles!==0||c.frequency?.interval_unit!=="MONTH"||c.frequency?.interval_count!==1||c.pricing_scheme?.fixed_price?.currency_code!=="USD"||Number(c.pricing_scheme?.fixed_price?.value)!==4.99)throw Error("Wrong sandbox plan");
 return p.id;
}
function sandboxBroker(paypal,origin){
 async function read(x){
  if(!/^I-[A-Z0-9]{8,32}$/.test(x.subscriptionId||""))throw Error("Invalid test subscription");
  const path="/v1/billing/subscriptions/"+x.subscriptionId,s=await paypal(path);
  if(s.id!==x.subscriptionId||s.plan_id!==x.planId||s.custom_id!==x.customId||s.plan_overridden===true)throw Error("Binding mismatch");
  return {path,s};
 }
 return {sandbox:true,
  createSubscription:async x=>{
   const r=await paypal("/v1/billing/subscriptions","POST",{plan_id:x.planId,custom_id:x.customId,quantity:"1",application_context:{brand_name:"BruA1 SANDBOX",shipping_preference:"NO_SHIPPING",user_action:"SUBSCRIBE_NOW",payment_method:{payee_preferred:"IMMEDIATE_PAYMENT_REQUIRED"},return_url:origin+"/network-test?returned=1",cancel_url:origin+"/network-test?canceled=1"}},x.requestId);
   if(!/^I-[A-Z0-9]{8,32}$/.test(r.id||""))throw Error("Invalid subscription");
   const checked=await paypal("/v1/billing/subscriptions/"+r.id);if(checked.plan_id!==x.planId||checked.custom_id!==x.customId)throw Error("Binding mismatch");
   return {...checked,links:r.links};
  },
  readSubscription:async x=>{
   const {path,s}=await read(x),last=Date.parse(s.billing_info?.last_payment?.time);
   if(!Number.isFinite(last))return {subscription:s,transactions:[]};
   const end=Math.min(Date.now(),last+86400000);if(end<last)throw Error("Future payment");
   const t=await paypal(path+"/transactions?start_time="+encodeURIComponent(new Date(last-86400000).toISOString())+"&end_time="+encodeURIComponent(new Date(end).toISOString()));
   if(!Array.isArray(t.transactions)||t.total_pages>1||t.links?.some(l=>l.rel==="next"))throw Error("Incomplete transactions");
   return {subscription:s,transactions:t.transactions};
  },
  cancelSubscription:async x=>{const {path,s}=await read(x);if(!["CANCELLED","EXPIRED"].includes(s.status))await paypal(path+"/cancel","POST",{reason:"Completed BruA1 sandbox test"});return {cancellationRequested:true};}
 };
}
export async function handleNetworkSandbox({env,path,data,origin,paypal}){
 if(env.PAYPAL_ENVIRONMENT!=="sandbox"||!env.ORDERS_DB)return json({error:"Sandbox only"},503);
 const db=env.ORDERS_DB,now=Math.floor(Date.now()/1000),broker=sandboxBroker(paypal,origin);
 if(path==="/api/network-test/start"){
  if(data.sandboxAcknowledged!==true)return json({error:"Confirm sandbox test"},400);
  const plan=await ensurePlan(paypal);
  await stmt(db,"INSERT INTO network_billing_plans VALUES('monthly',?,499,'USD',1) ON CONFLICT(cycle) DO NOTHING",plan).run();
  const saved=await first(db,"SELECT * FROM network_billing_plans WHERE cycle='monthly'");
  if(saved?.provider_plan_id!==plan||saved.enrollment_enabled!==1)throw Error("Sandbox plan mismatch");
  const id=crypto.randomUUID(),inv=secret();
  await db.batch([stmt(db,"INSERT INTO network_members VALUES(?,?,'INVITED',?)",id,"Sandbox QA member",now),stmt(db,"INSERT INTO network_invites VALUES(?,?,?,NULL)",await hash(inv),id,now+600)]);
  const auth=await redeemInvite(db,inv,now);
  const r=await beginEnrollment(db,broker,id,{cycle:"monthly",acceptedTerms:true,termsVersion:version},version,now);
  return json({sandbox:true,...r,sessionToken:auth.sessionToken});
 }
 if(!/^[a-f0-9]{64}$/.test(data.sessionToken||""))return json({error:"Test session required"},401);
 const member=await first(db,"SELECT m.id FROM network_members m JOIN network_sessions s ON s.member_id=m.id WHERE s.token_hash=? AND s.expires_at>? AND s.revoked_at IS NULL AND m.status='ACTIVE'",await hash(data.sessionToken),now);
 if(!member)return json({error:"Test session expired"},401);
 if(path==="/api/network-test/refresh"){const r=await refreshEnrollment(db,broker,member.id,now);return json({sandbox:true,...r});}
 if(path==="/api/network-test/cancel"){if(data.confirm!==true)return json({error:"Confirmation required"},400);return json({sandbox:true,...await cancelEnrollment(db,broker,member.id,now)});}
 if(path==="/api/network-test/chat"){
  const r=await networkRoute(new Request("https://internal.invalid/api/network/chat",{method:"POST",headers:{Origin:"https://brua1.com",Authorization:"Bearer "+data.sessionToken,"Content-Type":"application/json"},body:JSON.stringify({channel:"general",body:"Verified sandbox subscription QA message"})}),{NETWORK_DB:db,NETWORK_MEMBER_API_ENABLED:"true"});
  return json({sandbox:true,communityUnlocked:r.status===201},r.status);
 }
 return json({error:"Unknown sandbox operation"},404);
}
export function networkTestHtml(){return new Response(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>BruA1 Music Network — PayPal Sandbox Test</title><style>body{background:#11151e;color:#f5f5f5;font:16px/1.6 system-ui;max-width:650px;margin:30px auto;padding:20px}input,button{font:inherit;padding:10px;margin:8px 0}button{background:#e5b66b;color:#17140e;border:0;border-radius:6px}label{display:block}pre{white-space:pre-wrap}</style><script defer src="/network-test.js"></script><h1>Music Network subscription test</h1><p><strong>SANDBOX ONLY. No real money or live membership.</strong> Use a PayPal sandbox personal buyer account, not your real PayPal account.</p><label>Private sandbox test key <input id="key" type="password" autocomplete="off"></label><label><input id="accept" type="checkbox"> I understand this is a $4.99 monthly sandbox subscription.</label><button id="start">Create test subscription</button><button id="verify">Verify sandbox payment</button><button id="chat">Test community access</button><button id="cancel">Cancel sandbox subscription</button><pre id="result" role="status">Ready.</pre></html>`,{headers:{"Content-Type":"text/html; charset=utf-8","Cache-Control":"no-store","Referrer-Policy":"no-referrer","Content-Security-Policy":"default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'"}})}
export function networkTestJs(){return new Response(`"use strict";const el=id=>document.getElementById(id),result=el("result");let session=sessionStorage.getItem("brua1-sandbox-network")||"";async function send(action,extra={}){if(!el("key").value)throw Error("Enter the private sandbox test key.");const r=await fetch("/api/network-test/"+action,{method:"POST",headers:{Authorization:"Bearer "+el("key").value,"Content-Type":"application/json"},body:JSON.stringify({sessionToken:session,...extra})});const x=await r.json();if(!r.ok)throw Error(x.error||"Test failed");return x}function act(id,fn){el(id).addEventListener("click",async()=>{el(id).disabled=true;try{await fn()}catch(e){result.textContent=e.message}finally{el(id).disabled=false}})}act("start",async()=>{if(session)throw Error("Existing test session; verify or cancel it first.");if(!el("accept").checked)throw Error("Confirm test notice.");const x=await send("start",{sandboxAcknowledged:true});session=x.sessionToken;sessionStorage.setItem("brua1-sandbox-network",session);const u=new URL(x.approvalUrl);if(u.protocol!=="https:"||u.hostname!=="www.sandbox.paypal.com")throw Error("Invalid sandbox URL");location.assign(u.href)});act("verify",async()=>{const x=await send("refresh");result.textContent=JSON.stringify(x,null,2)});act("chat",async()=>{const x=await send("chat");result.textContent=x.communityUnlocked?"PASS: Verified sandbox member can post in chat.":"Community locked."});act("cancel",async()=>{if(!confirm("Cancel future sandbox renewals?"))return;const x=await send("cancel",{confirm:true});result.textContent=JSON.stringify(x,null,2)});`,{headers:{"Content-Type":"text/javascript; charset=utf-8","Cache-Control":"no-store","X-Content-Type-Options":"nosniff"}})}
