// BruA1 36 x 3 PAYPAL SANDBOX matrix — no production money, private masters or legal licenses.
import {MATRIX_TRACKS,MATRIX_HELD_IDS,MATRIX_TIERS,MATRIX_DRAFT_VERSION,sandboxSelection} from "./sandbox-skus.mjs";
const PAYPAL="https://api-m.sandbox.paypal.com",ORDER=/^[A-Z0-9]{10,30}$/,TOKEN=/^[a-f0-9]{64}$/;
const H={"Cache-Control":"no-store","X-Content-Type-Options":"nosniff","Referrer-Policy":"no-referrer","X-Frame-Options":"DENY"};
const json=(data,status=200)=>Response.json(data,{status,headers:H}),bad=(error,status)=>json({error},status);
const esc=x=>String(x).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const hex=a=>Array.from(a,b=>b.toString(16).padStart(2,"0")).join("");
const token=()=>hex(crypto.getRandomValues(new Uint8Array(32)));
const sha=async s=>hex(new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(s))));
const rows=MATRIX_TRACKS.map(t=>'<option value="'+esc(t.id)+'">'+esc(t.title)+'</option>').join("");

export function matrixHtml(){
  const html='<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>BruA1 Sandbox — 108 license tests</title>'+
    '<style>:root{color-scheme:dark}body{background:#10131a;color:#f7f7fa;font:16px/1.5 system-ui,sans-serif;max-width:720px;margin:25px auto;padding:20px}h1{font-size:28px}'+
    '.warning{border:1px solid #916529;padding:12px;background:#382a19}label{display:block;margin:14px 0 6px}select,input:not([type=checkbox]){width:100%;box-sizing:border-box;padding:12px;background:#222937;color:white;border:1px solid #64748b;border-radius:6px}'+
    'button{padding:12px 16px;margin:12px 8px 0 0;background:#edba62;color:#17130f;border:0;border-radius:6px;font-weight:700;cursor:pointer}button[hidden]{display:none}'+
    'pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#1d2532;padding:14px;border-radius:7px}</style><script defer src="/matrix.js"></script></head><body>'+
    '<h1>BruA1 PayPal Checkout — 108 SANDBOX TESTS</h1>'+
    '<p class="warning"><strong>TEST ONLY — NO REAL MONEY.</strong> 36 instrumentals with Basic, Premium or Unlimited simulated payments. Only a harmless test receipt is delivered. No legal license, MP3 or WAV. BruA1.com real checkout is not active.</p>'+
    '<p>Chopin, Laid Back &amp; Litty and paralyzed remain available for listening only and are excluded from sandbox purchase choices.</p>'+
    '<label for="product">Choose instrumental</label><select id="product">'+rows+'</select>'+
    '<label for="tier">Choose test license</label><select id="tier"><option value="basic">Basic — $29.99 (MP3 eventual)</option><option value="premium">Premium — $59.99 (MP3 + WAV eventual)</option><option value="unlimited">Unlimited — $99.99 (MP3 + WAV eventual)</option></select>'+
    '<p id="price">Test charge: $29.99 USD sandbox funds</p>'+
    '<label for="key">Private sandbox test key</label><input id="key" type="password" autocomplete="off" placeholder="Cloudflare CHECKOUT_TEST_KEY">'+
    '<label><input type="checkbox" id="accept"> I acknowledge this is a sandbox test, not a real purchase or license.</label>'+
    '<button id="create" type="button">Create Selected PayPal SANDBOX Order</button>'+
    '<button id="capture" type="button" hidden>Capture Approved TEST Payment</button>'+
    '<button id="issue" type="button" hidden>Issue Test Receipt Token</button>'+
    '<button id="download" type="button" hidden>Download Test Receipt</button>'+
    '<p id="notice"></p><pre id="result" aria-live="polite">Ready for sandbox purchase testing.</pre></body></html>';
  return new Response(html,{headers:{...H,"Content-Type":"text/html; charset=utf-8",
    "Content-Security-Policy":"default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'"}});
}
const SCRIPT=String.raw`"use strict";
const $=id=>document.getElementById(id),query=new URLSearchParams(location.search),orderId=query.get("token");
let receiptToken="";const out=$("result");
if(orderId){$("capture").hidden=false;$("notice").textContent="Returned from PayPal Sandbox. Reenter your private test key to capture.";}
if(query.has("cancelled"))$("notice").textContent="Sandbox payment canceled; no money charged.";
$("tier").onchange=()=>{$("price").textContent="Test charge: $"+({basic:"29.99",premium:"59.99",unlimited:"99.99"}[$("tier").value]||"—")+" USD sandbox funds";};
async function send(path,body){
 if(!$("key").value)throw Error("Enter the private sandbox test key.");
 const r=await fetch(path,{method:"POST",headers:{"Content-Type":"application/json","Authorization":"Bearer "+$("key").value},body:JSON.stringify(body)});
 if(!r.ok){const e=await r.json().catch(()=>({}));throw Error(e.error||"Sandbox request failed: "+r.status);}return r;
}
async function action(fn){out.textContent="Processing test…";try{await fn();}catch(e){out.textContent=e.message;}}
$("create").onclick=()=>action(async()=>{
 if(!$("accept").checked)throw Error("Confirm sandbox-only testing first.");
 const d=await(await send("/api/matrix/create-order",{productId:$("product").value,tier:$("tier").value,sandboxAcknowledged:true})).json();
 out.textContent="Opening PayPal SANDBOX for "+d.title+" / "+d.tier+" ($"+d.amount+")…";location.assign(d.approve);
});
$("capture").onclick=()=>action(async()=>{
 if(!orderId)throw Error("No PayPal sandbox order was returned.");
 const d=await(await send("/api/matrix/capture-order",{orderId})).json();
 out.textContent="Verified SANDBOX payment: "+d.status+" "+d.title+" "+d.tier+". No music delivered.";$("issue").hidden=false;
});
$("issue").onclick=()=>action(async()=>{
 const d=await(await send("/api/matrix/issue-test-receipt",{orderId})).json();
 receiptToken=d.token;$("download").hidden=false;out.textContent="Harmless test receipt token issued for "+d.title+" ("+d.tier+"), 15 minutes, 3 downloads.";
});
$("download").onclick=()=>action(async()=>{
 if(!receiptToken)throw Error("Issue test token first.");
 const r=await send("/api/matrix/download-test-receipt",{token:receiptToken});
 const blob=await r.blob(),url=URL.createObjectURL(blob),a=document.createElement("a");
 a.href=url;a.download="BruA1-SANDBOX-Receipt.txt";document.body.append(a);a.click();a.remove();
 setTimeout(()=>URL.revokeObjectURL(url),10000);out.textContent="Downloaded TEST receipt only. No full audio or legal license.";
});`;
export function matrixJs(){return new Response(SCRIPT,{headers:{...H,"Content-Type":"text/javascript; charset=utf-8"}});}
async function paypal(env,path,method="GET",body,idempotencyKey){
 const auth=await fetch(PAYPAL+"/v1/oauth2/token",{method:"POST",
  headers:{Authorization:"Basic "+btoa(env.PAYPAL_CLIENT_ID+":"+env.PAYPAL_CLIENT_SECRET),
   "Content-Type":"application/x-www-form-urlencoded"},body:"grant_type=client_credentials"});
 if(!auth.ok)throw Error("Sandbox OAuth authorization failed");
 const accessToken=(await auth.json()).access_token;
 if(typeof accessToken!=="string"||!accessToken)throw Error("Sandbox OAuth token unavailable");
 const headers={Authorization:"Bearer "+accessToken,"Content-Type":"application/json",Prefer:"return=representation"};
 if(method==="POST")headers["PayPal-Request-Id"]=idempotencyKey||crypto.randomUUID();
 const response=await fetch(PAYPAL+path,{method,headers,body:body===undefined?undefined:JSON.stringify(body)});
 const data=await response.json().catch(()=>({}));
 if(!response.ok)throw Error("PayPal sandbox request failed");
 return data;
}
const rowSelection=r=>sandboxSelection(r?.product_id,r?.tier);
const validRow=(r,s)=>!!s&&r.product_id===s.id&&r.tier===s.tier&&Number(r.price_cents)===s.priceCents&&r.currency==="USD";
const exactOrder=(o,s)=>o?.purchase_units?.length===1&&o.purchase_units[0]?.custom_id===s.customId&&
  o.purchase_units[0]?.amount?.currency_code==="USD"&&o.purchase_units[0]?.amount?.value===s.price;
function completedCapture(o,s,merchantId){
 if(o?.status!=="COMPLETED"||!exactOrder(o,s))return null;
 const u=o.purchase_units[0];
 if(merchantId&&u.payee?.merchant_id!==merchantId)return null;
 const caps=u.payments?.captures;
 if(!Array.isArray(caps)||caps.length!==1)return null;
 const cap=caps[0];
 return cap?.id&&cap.status==="COMPLETED"&&cap.amount?.currency_code==="USD"&&cap.amount?.value===s.price?cap:null;
}
async function create(env,data,origin){
 const s=sandboxSelection(data.productId,data.tier);
 if(!s||data.sandboxAcknowledged!==true)return bad("Unsupported test product/tier or acknowledgement missing",400);
 const o=await paypal(env,"/v2/checkout/orders","POST",{
  intent:"CAPTURE",purchase_units:[{custom_id:s.customId,description:"BruA1 "+s.tier+" — SANDBOX TEST ONLY",
   amount:{currency_code:"USD",value:s.price}}],
  payment_source:{paypal:{experience_context:{
   brand_name:"BruA1 SANDBOX",user_action:"PAY_NOW",return_url:origin+"/matrix",cancel_url:origin+"/matrix?cancelled=1"
  }}}
 });
 const approve=o.links?.find(x=>x.rel==="payer-action"||x.rel==="approve")?.href;
 let uri;try{uri=new URL(approve)}catch{}
 if(!ORDER.test(o.id||"")||!uri||uri.protocol!=="https:"||uri.hostname!=="www.sandbox.paypal.com"||uri.username||uri.password)
   return bad("PayPal sandbox test order or approval link unavailable",502);
 await env.ORDERS_DB.prepare(
  "INSERT INTO matrix_orders(id,paypal_order_id,product_id,product_title,tier,price_cents,currency,status) VALUES(?,?,?,?,?,?,?, 'CREATED')"
 ).bind(crypto.randomUUID(),o.id,s.id,s.title,s.tier,s.priceCents,"USD").run();
 return json({sandbox:true,orderId:o.id,approve:uri.toString(),amount:s.price,title:s.title,tier:s.tier,realAudioDelivery:false});
}
async function capture(env,id){
 const row=await env.ORDERS_DB.prepare(
  "SELECT id,paypal_order_id,product_id,product_title,tier,price_cents,currency,status,paypal_capture_id FROM matrix_orders WHERE paypal_order_id=?"
 ).bind(id).first();
 const s=rowSelection(row);
 if(!validRow(row,s))return bad("Unknown sandbox order",404);
 const detail=await paypal(env,"/v2/checkout/orders/"+id);
 if(detail.id!==id||!exactOrder(detail,s))return bad("Sandbox order price/tier/product mismatch",409);
 let cap=completedCapture(detail,s,env.PAYPAL_MERCHANT_ID);
 if(row.status==="COMPLETED"){
  if(!cap||cap.id!==row.paypal_capture_id)return bad("Sandbox capture reconciliation required",409);
  return json({sandbox:true,status:"COMPLETED",alreadyRecorded:true,verified:true,orderId:id,title:s.title,tier:s.tier,fulfillment:"receipt-only"});
 }
 if(!["CREATED","CAPTURING"].includes(row.status))return bad("Sandbox order cannot be captured",409);
 if(!cap){
  if(row.status==="CAPTURING")return bad("Capture unresolved; reconcile with PayPal Sandbox before retrying",409);
  if(detail.status!=="APPROVED")return bad("Buyer sandbox approval required",409);
  const claim=await env.ORDERS_DB.prepare("UPDATE matrix_orders SET status='CAPTURING' WHERE id=? AND status='CREATED'").bind(row.id).run();
  if(claim.meta?.changes!==1)return bad("Capture processing already started",409);
  try{await paypal(env,"/v2/checkout/orders/"+id+"/capture","POST",{},"brua1-matrix-"+id)}
  catch{return bad("Capture outcome uncertain; review provider before retrying",502)}
  const after=await paypal(env,"/v2/checkout/orders/"+id);
  cap=after.id===id?completedCapture(after,s,env.PAYPAL_MERCHANT_ID):null;
 }
 if(!cap)return bad("Sandbox provider capture verification failed",409);
 const up=await env.ORDERS_DB.prepare(
  "UPDATE matrix_orders SET status='COMPLETED',paypal_capture_id=?,completed_at=CURRENT_TIMESTAMP WHERE id=? AND status IN ('CREATED','CAPTURING')"
 ).bind(cap.id,row.id).run();
 if(up.meta?.changes!==1)return bad("Sandbox record reconciliation required",409);
 return json({sandbox:true,status:"COMPLETED",verified:true,orderId:id,title:s.title,tier:s.tier,fulfillment:"receipt-only"});
}
async function issue(env,id){
 const row=await env.ORDERS_DB.prepare(
  "SELECT id,paypal_order_id,product_id,product_title,tier,price_cents,currency,status,paypal_capture_id FROM matrix_orders WHERE paypal_order_id=?"
 ).bind(id).first();
 const s=rowSelection(row);
 if(!validRow(row,s)||row.status!=="COMPLETED"||!row.paypal_capture_id)return bad("Verified completed sandbox payment required",403);
 const details=await paypal(env,"/v2/checkout/orders/"+id);
 const cap=details.id===id?completedCapture(details,s,env.PAYPAL_MERCHANT_ID):null;
 if(!cap||cap.id!==row.paypal_capture_id)return bad("PayPal sandbox payment re-verification failed",409);
 const raw=token(),hashed=await sha(raw);
 await env.ORDERS_DB.prepare(
  "INSERT INTO matrix_receipt_tokens(token_hash,order_id,expires_at,max_downloads) VALUES(?,?,datetime('now','+15 minutes'),3)"
 ).bind(hashed,row.id).run();
 return json({sandbox:true,token:raw,title:s.title,tier:s.tier,expiresInSeconds:900,maxDownloads:3,realAudioDelivery:false});
}
async function download(env,raw){
 const hashed=await sha(raw);
 const r=await env.ORDERS_DB.prepare(
  "SELECT o.paypal_order_id,o.product_id,o.product_title,o.tier,o.price_cents,o.currency,o.status "+
  "FROM matrix_receipt_tokens t JOIN matrix_orders o ON o.id=t.order_id WHERE t.token_hash=? "+
  "AND t.expires_at>datetime('now') AND t.download_count<t.max_downloads AND o.status='COMPLETED'"
 ).bind(hashed).first();
 const s=rowSelection(r);
 if(!validRow(r,s)||r.status!=="COMPLETED")return bad("Expired or invalid test receipt access",403);
 const claim=await env.ORDERS_DB.prepare(
  "UPDATE matrix_receipt_tokens SET download_count=download_count+1 WHERE token_hash=? AND expires_at>datetime('now') AND download_count<max_downloads"
 ).bind(hashed).run();
 if(claim.meta?.changes!==1)return bad("Test receipt download limit reached",403);
 const body="BRUA1 — PAYPAL SANDBOX RECEIPT\nNO REAL MONEY OR LEGALLY ISSUED LICENSE.\nInstrumental: "+s.title+
  "\nProduct: "+s.id+"\nProposed tier: "+s.tier.toUpperCase()+"\nSimulated amount: $"+s.price+
  " USD\nSandbox order: "+r.paypal_order_id+"\nDraft: "+MATRIX_DRAFT_VERSION+
  "\nNO CLEAN MP3/WAV OR PRIVATE MASTER ACCESS.\n";
 return new Response(body,{headers:{...H,"Content-Type":"text/plain; charset=utf-8",
   "Content-Disposition":'attachment; filename="BruA1-SANDBOX-Receipt.txt"'}});
}
export async function handleMatrixApi({env,path,data,origin}){
 try{
  if(!env?.ORDERS_DB)return bad("Sandbox database unavailable",503);
  if(path==="/api/matrix/create-order")return await create(env,data,origin);
  if(path==="/api/matrix/capture-order"){
   if(!ORDER.test(data.orderId||""))return bad("Invalid sandbox order ID",400);
   return await capture(env,data.orderId);
  }
  if(path==="/api/matrix/issue-test-receipt"){
   if(!ORDER.test(data.orderId||""))return bad("Invalid sandbox order ID",400);
   return await issue(env,data.orderId);
  }
  if(path==="/api/matrix/download-test-receipt"){
   if(!TOKEN.test(data.token||""))return bad("Invalid sandbox receipt token",400);
   return await download(env,data.token);
  }
  return bad("Not found",404);
 }catch{
  return bad("Sandbox request failed safely; inspect restricted Worker logs",502);
 }
}
export const matrixSanityCheck=()=>({sandboxOnly:true,realMoney:false,masterAudio:false,
 tracks:MATRIX_TRACKS.length,variants:MATRIX_TRACKS.length*Object.keys(MATRIX_TIERS).length,held:MATRIX_HELD_IDS.length});
