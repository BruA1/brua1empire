import test from "node:test";
import assert from "node:assert/strict";
import worker from "../workers/brua1-checkout-sandbox/index.mjs";
import {MATRIX_TRACKS,MATRIX_HELD_IDS,MATRIX_TIERS,sandboxSelection} from "../workers/brua1-checkout-sandbox/sandbox-skus.mjs";
import {matrixSanityCheck} from "../workers/brua1-checkout-sandbox/sandbox-matrix.mjs";

const origin="https://brua1-checkout-sandbox.example.workers.dev";
const key="mock-sandbox-private-secret";
function setup(){
 const orders=new Map(),grants=new Map(),gateway=new Map();
 const counters={creates:0,captures:0},control={priceTamper:false,failCapture:false};
 const db={
  prepare(query){
   let args=[];
   return {
    bind(...a){args=a;return this;},
    async first(){
     if(query.includes("FROM matrix_orders WHERE paypal_order_id="))return orders.get(args[0])||null;
     if(query.includes("FROM matrix_receipt_tokens")){
      const tokenRow=grants.get(args[0]);if(!tokenRow||tokenRow.count>=3||tokenRow.expires<Date.now())return null;
      const row=[...orders.values()].find(o=>o.id===tokenRow.order);
      return row?.status==="COMPLETED"?{...row}:null;
     }
     throw Error("Unknown read: "+query);
    },
    async run(){
     if(query.startsWith("INSERT INTO matrix_orders")){
      const [id,paypal_order_id,product_id,product_title,tier,price_cents,currency]=args;
      orders.set(paypal_order_id,{id,paypal_order_id,product_id,product_title,tier,price_cents,currency,status:"CREATED",paypal_capture_id:null});
      return {meta:{changes:1}};
     }
     if(query.includes("UPDATE matrix_orders SET status='CAPTURING'")){
      const row=[...orders.values()].find(x=>x.id===args[0]);
      if(!row||row.status!=="CREATED")return {meta:{changes:0}};
      row.status="CAPTURING";return {meta:{changes:1}};
     }
     if(query.includes("UPDATE matrix_orders SET status='COMPLETED'")){
      const row=[...orders.values()].find(x=>x.id===args[1]);
      if(!row||!["CREATED","CAPTURING"].includes(row.status))return {meta:{changes:0}};
      row.status="COMPLETED";row.paypal_capture_id=args[0];
      return {meta:{changes:1}};
     }
     if(query.startsWith("INSERT INTO matrix_receipt_tokens")){
      grants.set(args[0],{order:args[1],count:0,expires:Date.now()+900000});
      return {meta:{changes:1}};
     }
     if(query.includes("UPDATE matrix_receipt_tokens SET download_count")){
      const g=grants.get(args[0]);
      if(!g||g.count>=3||g.expires<Date.now())return {meta:{changes:0}};
      g.count++;return {meta:{changes:1}};
     }
     throw Error("Unknown write: "+query);
    }
   };
  }
 };
 const env={PAYPAL_ENVIRONMENT:"sandbox",PAYPAL_CLIENT_ID:"MOCK_CLIENT",PAYPAL_CLIENT_SECRET:"MOCK_SECRET",CHECKOUT_TEST_KEY:key,ORDERS_DB:db};
 const original=globalThis.fetch;
 globalThis.fetch=async(url,options={})=>{
   const path=String(url),method=options.method||"GET";
   if(path.endsWith("/v1/oauth2/token"))return Response.json({access_token:"MOCK_ACCESS"});
   if(path.endsWith("/v2/checkout/orders")&&method==="POST"){
     counters.creates++;
     const id="3X"+String(counters.creates).padStart(15,"0");
     const order=JSON.parse(options.body);
     gateway.set(id,{order,approved:true,captured:false});
     return Response.json({id,links:[{rel:"approve",href:"https://www.sandbox.paypal.com/checkoutnow?token="+id}]});
   }
   const match=path.match(/\/v2\/checkout\/orders\/([A-Z0-9]+)(\/capture)?$/);
   if(match){
     const [,_id,capture]=match;const v=gateway.get(_id);
     if(!v)throw Error("Unknown mock PayPal order");
     if(capture&&method==="POST"){
       counters.captures++;
       if(control.failCapture)return Response.json({error:"Uncertain"},{status:502});
       v.captured=true;
     }
     const unit=structuredClone(v.order.purchase_units[0]);
     if(control.priceTamper)unit.amount.value="1.00";
     if(v.captured)unit.payments={captures:[{id:"CAPTURE-"+_id,status:"COMPLETED",amount:structuredClone(v.order.purchase_units[0].amount)}]};
     return Response.json({id:_id,status:v.captured?"COMPLETED":v.approved?"APPROVED":"CREATED",purchase_units:[unit]});
   }
   throw Error("Unexpected mock call "+path);
 };
 return {env,orders,gateway,grants,counters,control,restore:()=>{globalThis.fetch=original;}};
}
function req(path,body,withKey=key,from=origin){
 return new Request(origin+path,{method:"POST",headers:{"Origin":from,"Content-Type":"application/json","Authorization":"Bearer "+withKey},body:JSON.stringify(body)});
}
async function post(env,path,body,withKey=key,from=origin){
 const r=await worker.fetch(req(path,body,withKey,from),env);
 const type=r.headers.get("content-type")||"";
 return {status:r.status,data:type.includes("application/json")?await r.json():await r.text()};
}
test("all 36 tracks and 108 tiers are server-priced; held tracks never eligible",()=>{
 const sanity=matrixSanityCheck();
 assert.equal(sanity.tracks,36);assert.equal(sanity.variants,108);assert.equal(sanity.held,3);
 assert.equal(sanity.realMoney,false);assert.equal(sanity.masterAudio,false);
 const ids=new Set(MATRIX_TRACKS.map(x=>x.id));assert.equal(ids.size,36);
 for(const t of MATRIX_TRACKS){
  for(const [tier,cents] of Object.entries(MATRIX_TIERS)){
    const sel=sandboxSelection(t.id,tier);
    assert.equal(sel.priceCents,cents);assert.equal(sel.title,t.title);
  }
 }
 for(const id of MATRIX_HELD_IDS)
  assert.equal(sandboxSelection(id,"basic"),null);
 assert.equal(sandboxSelection("BRUA1-INS-0039","exclusive"),null);
});
test("matrix page visible, no real payment, no private master content",async()=>{
 const page=await worker.fetch(new Request(origin+"/matrix"),{});
 assert.equal(page.status,200);
 const html=await page.text();
 assert.match(html,/NO REAL MONEY/);
 assert.match(html,/NO REAL MONEY/);
 assert.match(html,/select id="product"/);
 assert.equal((html.match(/<option value="BRUA1-INS-/g)||[]).length,36);
 assert.equal(html.includes('<option value="BRUA1-INS-0004"'),false);
 assert.equal(html.includes('<option value="BRUA1-INS-0019"'),false);
 assert.equal(html.includes('<option value="BRUA1-INS-0026"'),false);
 const js=await worker.fetch(new Request(origin+"/matrix.js"),{});
 assert.equal(js.status,200);
 assert.match(await js.text(),/Create Selected|create-order/);
 assert.match(page.headers.get("content-security-policy"),/frame-ancestors 'none'/);
});
test("all 108 order choices resolve server-side; browser-supplied price ignored",async()=>{
 const s=setup();try{
  for(const t of MATRIX_TRACKS)for(const tier of Object.keys(MATRIX_TIERS)){
   const o=await post(s.env,"/api/matrix/create-order",{productId:t.id,tier,priceCents:1,sandboxAcknowledged:true});
   assert.equal(o.status,200,t.id+" "+tier);
   assert.equal(o.data.amount,(MATRIX_TIERS[tier]/100).toFixed(2));
   assert.equal(o.data.title,t.title);assert.equal(o.data.tier,tier);
   assert.match(o.data.approve,/www\.sandbox\.paypal\.com/);
  }
  assert.equal(s.counters.creates,108);
  assert.equal(s.orders.size,108);
 }finally{s.restore();}
});
test("matrix rejects 3 held tracks, exclusive, missing consent and bad credentials/origin",async()=>{
 const s=setup();try{
  for(const id of MATRIX_HELD_IDS){
   const o=await post(s.env,"/api/matrix/create-order",{productId:id,tier:"basic",sandboxAcknowledged:true});
   assert.equal(o.status,400);
  }
  for(const tier of ["exclusive","impossible"]){
   const o=await post(s.env,"/api/matrix/create-order",{productId:MATRIX_TRACKS[0].id,tier,sandboxAcknowledged:true});
   assert.equal(o.status,400);
  }
  assert.equal((await post(s.env,"/api/matrix/create-order",{productId:MATRIX_TRACKS[0].id,tier:"basic",sandboxAcknowledged:false})).status,400);
  assert.equal((await post(s.env,"/api/matrix/create-order",{}, "WRONG")).status,401);
  assert.equal((await post(s.env,"/api/matrix/create-order",{}, key,"https://attacker.test")).status,403);
  assert.equal(s.counters.creates,0);
 }finally{s.restore();}
});
test("basic, premium, unlimited mock PayPal capture -> token -> 3 downloadable harmless receipts",async()=>{
 const s=setup();try{
  for(const tier of ["basic","premium","unlimited"]){
   const created=await post(s.env,"/api/matrix/create-order",{productId:MATRIX_TRACKS[0].id,tier,sandboxAcknowledged:true});
   assert.equal(created.status,200);
   const id=created.data.orderId;
   const cap=await post(s.env,"/api/matrix/capture-order",{orderId:id});
   assert.equal(cap.status,200);assert.equal(cap.data.status,"COMPLETED");
   const repeated=await post(s.env,"/api/matrix/capture-order",{orderId:id});
   assert.equal(repeated.status,200);assert.equal(repeated.data.alreadyRecorded,true);
   const issued=await post(s.env,"/api/matrix/issue-test-receipt",{orderId:id});
   assert.equal(issued.status,200);assert.match(issued.data.token,/^[a-f0-9]{64}$/);
   assert.equal(s.grants.has(issued.data.token),false);
   for(let k=0;k<3;k++){
    const receipt=await post(s.env,"/api/matrix/download-test-receipt",{token:issued.data.token});
    assert.equal(receipt.status,200);
    assert.match(receipt.data,/NO REAL MONEY OR LEGALLY ISSUED LICENSE/);
    assert.match(receipt.data,new RegExp("Proposed tier: "+tier.toUpperCase()));
    assert.match(receipt.data,/NO CLEAN MP3\/WAV/);
   }
   assert.equal((await post(s.env,"/api/matrix/download-test-receipt",{token:issued.data.token})).status,403);
  }
  assert.equal(s.counters.captures,3);
 }finally{s.restore();}
});
test("provider price tampering denies capture, uncertain capture never retried blindly",async()=>{
 const s=setup();try{
  const p=MATRIX_TRACKS[1].id;
  const created=await post(s.env,"/api/matrix/create-order",{productId:p,tier:"premium",sandboxAcknowledged:true});
  s.control.priceTamper=true;
  assert.equal((await post(s.env,"/api/matrix/capture-order",{orderId:created.data.orderId})).status,409);
  assert.equal(s.counters.captures,0);
  s.control.priceTamper=false;
  s.control.failCapture=true;
  assert.equal((await post(s.env,"/api/matrix/capture-order",{orderId:created.data.orderId})).status,502);
  assert.equal((await post(s.env,"/api/matrix/capture-order",{orderId:created.data.orderId})).status,409);
  assert.equal(s.counters.captures,1);
  s.gateway.get(created.data.orderId).captured=true;
  assert.equal((await post(s.env,"/api/matrix/capture-order",{orderId:created.data.orderId})).status,200);
  assert.equal(s.counters.captures,1);
 }finally{s.restore();}
});
