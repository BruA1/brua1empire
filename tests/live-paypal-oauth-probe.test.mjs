import test from "node:test";
import assert from "node:assert/strict";
import worker,{paypalLiveAuthProbe} from "../workers/brua1-checkout-production/index.mjs";
const base="https://brua1-checkout-production.test.workers.dev";
const secret="PLACEHOLDER-LIVE-SECRET-FOR-TESTS";
const env={
  PAYPAL_ENVIRONMENT:"live",
  PAYPAL_CLIENT_ID:"PLACEHOLDER-LIVE-CLIENT-FOR-TESTS",
  PAYPAL_CLIENT_SECRET:secret,
  LIVE_CHECKOUT_ENABLED:"false",
  LICENSE_ISSUANCE_ENABLED:"false",
  REAL_AUDIO_DELIVERY_ENABLED:"false"
};
const freshNonce=()=>String(Date.now())+"."+"c".repeat(64);
function invoke(key,method="POST"){
 return new Request(base+"/internal/verify-live-oauth",{
   method,headers:{"Authorization":"Bearer "+key},body:method==="POST"?"":undefined
 });
}
test("Live PayPal accepts valid credentials via OAuth only; no access token returned",async()=>{
 const observed=[];
 const transport=async(url,options)=>{
  observed.push({url,method:options.method,redirect:options.redirect,body:options.body});
  assert.equal(url,"https://api-m.paypal.com/v1/oauth2/token");
  assert.equal(options.method,"POST");
  assert.equal(options.redirect,"error");
  assert.equal(options.body,"grant_type=client_credentials");
  assert.equal(atob(options.headers.Authorization.slice(6)),env.PAYPAL_CLIENT_ID+":"+secret);
  return Response.json({access_token:"DO-NOT-EXPOSE-ACCESS-TOKEN",
    token_type:"Bearer",expires_in:32400});
 };
 const verified=await paypalLiveAuthProbe(env,transport);
 assert.deepEqual(verified,{verified:true,code:"PAYPAL_LIVE_OAUTH_ACCEPTED",httpStatus:200});
 assert.equal(observed.length,1);
 assert(!JSON.stringify(verified).includes("DO-NOT-EXPOSE"));
});
test("bad credentials, invalid OAuth and provider failure return safe errors",async()=>{
 for(const [mock,expected] of [
  [async()=>Response.json({error:"invalid_client"},{status:401}),"PAYPAL_REJECTED_CREDENTIALS"],
  [async()=>Response.json({error:"unauthorized"},{status:403}),"PAYPAL_REJECTED_CREDENTIALS"],
  [async()=>Response.json({error:"outage"},{status:503}),"PAYPAL_OAUTH_UNAVAILABLE"],
  [async()=>Response.json({access_token:"sensitive",token_type:"Bearer",expires_in:0}),"PAYPAL_OAUTH_INVALID_RESPONSE"],
  [async()=>{throw Error("network");},"PAYPAL_NETWORK_OR_TLS_ERROR"]
 ]){
   const r=await paypalLiveAuthProbe(env,mock);
   assert.equal(r.verified,false);
   assert.equal(r.code,expected);
   assert.equal(r.httpStatus,502);
   assert(!JSON.stringify(r).includes("sensitive"));
 }
});
test("missing credential and unlocked payment flags refuse OAuth without network calls",async()=>{
 let attempted=0;
 const spy=async()=>{attempted++;return Response.json({access_token:"danger"});};
 for(const broken of [
  {...env,PAYPAL_CLIENT_ID:""},
  {...env,PAYPAL_CLIENT_SECRET:null},
  {...env,PAYPAL_ENVIRONMENT:"sandbox"},
  {...env,LIVE_CHECKOUT_ENABLED:"true"},
  {...env,LICENSE_ISSUANCE_ENABLED:"true"},
  {...env,REAL_AUDIO_DELIVERY_ENABLED:"true"}
 ]){
  const r=await paypalLiveAuthProbe(broken,spy);
  assert.equal(r.verified,false);
  assert.equal(r.httpStatus,503);
 }
 assert.equal(attempted,0);
});
test("no key, wrong key, expired key, or GET cannot invoke PayPal",async()=>{
 const nonce=freshNonce(),expired=String(Date.now()-11*60*1000)+"."+"c".repeat(64);
 const mockEnv={...env,PAYPAL_VERIFY_NONCE:nonce};
 let calls=0;const original=globalThis.fetch;
 globalThis.fetch=async()=>{calls++;throw Error("MUST NOT CALL PAYPAL");};
 try{
   for(const item of [
      {request:invoke("WRONG"),environment:mockEnv},
      {request:invoke(nonce,"GET"),environment:mockEnv},
      {request:invoke(nonce),environment:{...mockEnv,PAYPAL_VERIFY_NONCE:expired}},
      {request:new Request(base+"/internal/verify-live-oauth",{method:"POST"}),environment:mockEnv}
   ]){
     const r=await worker.fetch(item.request,item.environment);
     assert([401,405].includes(r.status));
     assert(!JSON.stringify(await r.json()).includes(secret));
   }
   assert.equal(calls,0);
 }finally{globalThis.fetch=original;}
});
test("authenticated ephemeral check reports only a boolean and no charges",async()=>{
 const nonce=freshNonce(),mockEnv={...env,PAYPAL_VERIFY_NONCE:nonce};
 let calls=0;const old=globalThis.fetch;
 globalThis.fetch=async(url,options)=>{
  calls++;
  assert.equal(url,"https://api-m.paypal.com/v1/oauth2/token");
  assert.equal(options.method,"POST");
  return Response.json({access_token:"VERY-PRIVATE-ACCESS-TOKEN",token_type:"Bearer",expires_in:3600});
 };
 try{
   const r=await worker.fetch(invoke(nonce),mockEnv);
   assert.equal(r.status,200);assert.equal(calls,1);
   const txt=await r.text(),body=JSON.parse(txt);
   assert.equal(body.verified,true);
   assert.equal(body.code,"PAYPAL_LIVE_OAUTH_ACCEPTED");
   assert.equal(body.paymentsEnabled,false);
   for(const secretText of [secret,"VERY-PRIVATE-ACCESS-TOKEN",env.PAYPAL_CLIENT_ID,nonce])
    assert(!txt.includes(secretText));
   const capture=await worker.fetch(new Request(base+"/api/capture-order",{method:"POST"}),mockEnv);
   assert.equal(capture.status,503);
 }finally{globalThis.fetch=old;}
});
