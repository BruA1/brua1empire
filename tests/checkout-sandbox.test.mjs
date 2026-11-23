import test from "node:test";
import assert from "node:assert/strict";
import worker from "../workers/brua1-checkout-sandbox/index.mjs";

const origin = "https://brua1-checkout-sandbox.example.workers.dev";
const payPalId = "3X123456789012345";
const captureId = "6FG12345678901234";
const custom = "BRUA1-INS-0001:basic:BRUA1-DRAFT-V2-2026-11-23";
const purchaseUnit = () => ({custom_id: custom, amount: {currency_code:"USD", value:"29.99"}});

function setup() {
  const products = new Map([["BRUA1-INS-0001",{id:"BRUA1-INS-0001",title:"108 in the Shade",price_cents:2999,currency:"USD",license_type:"basic",active:0}]]);
  const orders = new Map(), tokens = new Map();
  const state = { created: 0, captures: 0, captured: false, approved: true, tampered: false, failCapture: false };
  const db = {
    prepare(query) { let args=[];return {
      bind(...values){args=values;return this;},
      async first(){
        if (query.includes("FROM products")) return products.get(args[0]) ?? null;
        if (query.includes("FROM download_tokens")) {
          const t=tokens.get(args[0]);if(!t||t.count>=t.max||t.expires<Date.now())return null;
          const o=[...orders.values()].find(o=>o.id===t.order); if(!o||o.status!=="COMPLETED")return null;
          return {paypal_order_id:o.paypal_order_id,product_id:o.product_id,status:o.status};
        }
        if (query.includes("FROM orders")) return [...orders.values()].find(o=>o.paypal_order_id===args[0]) ?? null;
        throw Error("Unhandled query: "+query);
      },
      async run(){
        if (query.startsWith("INSERT INTO orders")) {
          const [id,paypal_order_id,product_id,amount_cents,currency]=args;
          orders.set(paypal_order_id,{id,paypal_order_id,product_id,amount_cents,currency,status:"CREATED",paypal_capture_id:null});
          return {meta:{changes:1}};
        }
        if (query.includes("UPDATE orders SET status = 'CAPTURING'")) {
          const o=[...orders.values()].find(o=>o.id===args[0]);if(!o||o.status!=="CREATED")return {meta:{changes:0}};
          o.status="CAPTURING";return {meta:{changes:1}};
        }
        if (query.includes("UPDATE orders SET status = 'COMPLETED'")) {
          const o=[...orders.values()].find(o=>o.id===args[1]);if(!o||!["CREATED","CAPTURING"].includes(o.status))return {meta:{changes:0}};
          o.status="COMPLETED";o.paypal_capture_id=args[0];return {meta:{changes:1}};
        }
        if (query.startsWith("INSERT INTO download_tokens")) {
          tokens.set(args[0],{order:args[1],expires:Date.now()+900000,max:3,count:0});return {meta:{changes:1}};
        }
        if (query.includes("UPDATE download_tokens SET download_count")) {
          const t=tokens.get(args[0]);if(!t||t.count>=t.max||t.expires<Date.now())return {meta:{changes:0}};
          t.count++;return {meta:{changes:1}};
        }
        throw Error("Unhandled run query: "+query);
      }
    } }
  };
  const env={PAYPAL_ENVIRONMENT:"sandbox",PAYPAL_CLIENT_ID:"TEST_ID",PAYPAL_CLIENT_SECRET:"TEST_SECRET",CHECKOUT_TEST_KEY:"a-very-long-private-test-key",ORDERS_DB:db};
  const fetchOriginal=globalThis.fetch;
  globalThis.fetch = async (raw,opts={})=>{
    const u=String(raw);
    if(u.endsWith("/v1/oauth2/token"))return Response.json({access_token:"MOCK_SANDBOX_ACCESS_TOKEN"});
    if(u.endsWith("/v2/checkout/orders") && opts.method==="POST"){
      state.created++;
      return Response.json({id:payPalId,links:[{rel:"approve",href:"https://www.sandbox.paypal.com/checkoutnow?token="+payPalId}]});
    }
    if(u.endsWith("/v2/checkout/orders/"+payPalId) && opts.method==="GET"){
      const unit=purchaseUnit();
      if(state.tampered)unit.amount.value="1.00";
      if(state.captured)unit.payments={captures:[{id:captureId,status:"COMPLETED",amount:{currency_code:"USD",value:"29.99"}}]};
      return Response.json({status:state.captured?"COMPLETED":state.approved?"APPROVED":"CREATED",purchase_units:[unit]});
    }
    if(u.endsWith("/v2/checkout/orders/"+payPalId+"/capture") && opts.method==="POST"){
      state.captures++;if(state.failCapture) return Response.json({error:"mock timeout"}, {status:500});
      state.captured=true;return Response.json({status:"COMPLETED",purchase_units:[{...purchaseUnit(),payments:{captures:[{id:captureId,status:"COMPLETED",amount:{currency_code:"USD",value:"29.99"}}]}}]});
    }
    throw Error("Unexpected sandbox request: "+u);
  };
  const restore=()=>globalThis.fetch=fetchOriginal;
  return {env,state,restore,orders,tokens};
}
function req(path, body, key="a-very-long-private-test-key", requestOrigin=origin) {
  return new Request(origin+path,{method:"POST",headers:{"Content-Type":"application/json","Origin":requestOrigin,"Authorization":"Bearer "+key},body:JSON.stringify(body)});
}
async function post(env,path,body, key, requestOrigin){
  const r=await worker.fetch(req(path,body,key,requestOrigin),env);
  let contentType=r.headers.get("content-type")||"";
  const data=contentType.includes("application/json")?await r.json():await r.text();
  return {status:r.status,data,headers:r.headers};
}
test("GET health and test page are sandbox only; no secret, no audio binding", async()=>{
  const response=await worker.fetch(new Request(origin+"/health"),{});
  assert.equal(response.status,200);
  const v=await response.json();assert.equal(v.livePayments,false);assert.equal(v.realAudioDelivery,false);
  const page=await worker.fetch(new Request(origin+"/test"),{});
  assert.equal(page.status,200);
  assert.match(await page.text(),/NO REAL MONEY/);
  assert.match(page.headers.get("content-security-policy"),/frame-ancestors 'none'/);
});
test("API denies absent configuration, wrong origin and wrong key", async()=>{
  const s=setup();try{
    const noEnv=await post({},"/api/create-order",{});assert.equal(noEnv.status,503);
    const badOrigin=await post(s.env,"/api/create-order",{},undefined,"https://attacker.example");assert.equal(badOrigin.status,403);
    const badKey=await post(s.env,"/api/create-order",{},"invalid-test-key");assert.equal(badKey.status,401);
    assert.equal(s.state.created,0);
  }finally{s.restore();}
});
test("price, tier, test acknowledgment and product are server-validated",async()=>{
  const s=setup();try{
    const incorrect=await post(s.env,"/api/create-order",{productId:"BRUA1-INS-0001",tier:"basic",amount:"0.01",sandboxAcknowledged:true});
    assert.equal(incorrect.status,200); // Browser-supplied price deliberately ignored.
    assert.equal(incorrect.data.amount,"29.99");
    const badTier=await post(s.env,"/api/create-order",{productId:"BRUA1-INS-0001",tier:"exclusive",sandboxAcknowledged:true});
    assert.equal(badTier.status,400);
    const badProduct=await post(s.env,"/api/create-order",{productId:"BRUA1-INS-0039",tier:"basic",sandboxAcknowledged:true});
    assert.equal(badProduct.status,400);
    const noConsent=await post(s.env,"/api/create-order",{productId:"BRUA1-INS-0001",tier:"basic",sandboxAcknowledged:false});
    assert.equal(noConsent.status,400);
    assert.equal(s.state.created,1);
  }finally{s.restore();}
});
test("sandbox capture verified before harmless fulfillment; duplicate capture idempotent",async()=>{
  const s=setup();try{
    const created=await post(s.env,"/api/create-order",{productId:"BRUA1-INS-0001",tier:"basic",sandboxAcknowledged:true});
    assert.equal(created.status,200);
    assert.equal(created.data.orderId,payPalId);
    assert.match(created.data.approve,/www\.sandbox\.paypal\.com/);
    assert.equal(s.orders.size,1);
    const capture=await post(s.env,"/api/capture-order",{orderId:payPalId});
    assert.equal(capture.status,200);assert.equal(capture.data.verified,true);assert.equal(s.state.captures,1);
    const second=await post(s.env,"/api/capture-order",{orderId:payPalId});
    assert.equal(second.status,200);assert.equal(second.data.alreadyRecorded,true);assert.equal(s.state.captures,1);
    const issued=await post(s.env,"/api/issue-test-receipt",{orderId:payPalId});
    assert.equal(issued.status,200);assert.match(issued.data.token,/^[a-f0-9]{64}$/);
    const rawToken=issued.data.token;
    assert.equal(s.tokens.has(rawToken),false); // Only SHA-256 hash is persisted.
    for(let i=0;i<3;i++){
      const receipt=await post(s.env,"/api/download-test-receipt",{token:rawToken});
      assert.equal(receipt.status,200);assert.match(receipt.data,/No MP3\/WAV file was or will be delivered/);
      assert.equal(receipt.headers.get("content-type").includes("audio"),false);
    }
    const exhausted=await post(s.env,"/api/download-test-receipt",{token:rawToken});assert.equal(exhausted.status,403);
  }finally{s.restore();}
});
test("PayPal amount mismatch blocks capture",async()=>{
  const s=setup();try{
    await post(s.env,"/api/create-order",{productId:"BRUA1-INS-0001",tier:"basic",sandboxAcknowledged:true});
    s.state.tampered=true;
    const captured=await post(s.env,"/api/capture-order",{orderId:payPalId});
    assert.equal(captured.status,409);assert.equal(s.state.captures,0);
  }finally{s.restore();}
});
test("uncertain capture never blindly charges again; successful provider reconciliation allowed",async()=>{
  const s=setup();try{
    await post(s.env,"/api/create-order",{productId:"BRUA1-INS-0001",tier:"basic",sandboxAcknowledged:true});
    s.state.failCapture=true;
    const uncertain=await post(s.env,"/api/capture-order",{orderId:payPalId});
    assert.equal(uncertain.status,502);assert.equal(s.state.captures,1);
    const again=await post(s.env,"/api/capture-order",{orderId:payPalId});
    assert.equal(again.status,409);assert.equal(s.state.captures,1);
    s.state.captured=true;
    const reconciled=await post(s.env,"/api/capture-order",{orderId:payPalId});
    assert.equal(reconciled.status,200);assert.equal(reconciled.data.verified,true);assert.equal(s.state.captures,1);
  }finally{s.restore();}
});
