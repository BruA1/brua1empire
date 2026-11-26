import {redeemInvite,login,logout} from "../workers/brua1-music-network/auth.mjs";
import {networkRoute} from "../workers/brua1-music-network/index.mjs";
import {createHash} from "node:crypto";
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {DatabaseSync} from "node:sqlite";
import {Script} from "node:vm";
test("public preview is linked, honest, and contains no checkout or collection form",()=>{const html=fs.readFileSync("music-network.html","utf8"),home=fs.readFileSync("index.html","utf8"),allow=fs.readFileSync(".assetsignore","utf8");assert(home.includes('href="music-network.html"'));assert(html.includes("Development preview"));assert(html.includes("fictional examples"));assert(!/<form\b|type="password"|type="email"/i.test(html));assert(!/paypal\.com\//i.test(html.replaceAll("https://www.paypal.com/myaccount/autopay/","")));assert.match(html,/<button id="subscribe-monthly"[^>]*disabled/);assert.match(html,/<button id="subscribe-annual"[^>]*disabled/);assert(html.includes("Memberships coming soon"));for(const f of ["music-network.html","music-network.css","music-network.js"])assert(allow.includes("!"+f));assert(!allow.includes("!workers/"));new Script(fs.readFileSync("music-network.js","utf8"));});
test("isolated community schema supports multiple roles and entitlement records",()=>{const db=new DatabaseSync(":memory:");db.exec(fs.readFileSync("workers/brua1-music-network/schema.sql","utf8"));db.exec("INSERT INTO network_members VALUES ('m1','Example','ACTIVE',1); INSERT INTO network_memberships VALUES ('m1',NULL,'TRIAL',100,1); INSERT INTO network_profiles(member_id,display_name) VALUES('m1','Example'); INSERT INTO network_roles VALUES('m1','producer'),('m1','musician');");assert.equal(db.prepare("SELECT count(*) AS n FROM network_roles").get().n,2);assert.equal(db.prepare("SELECT directory_visible FROM network_profiles").get().directory_visible,0);assert.equal(db.prepare("SELECT count(*) AS n FROM network_channels").get().n,10);assert.throws(()=>db.exec("INSERT INTO network_roles VALUES('m1','invalid')"));assert.throws(()=>db.exec("INSERT INTO network_blocks VALUES('m1','m1')"));db.close();});

test("member API rejects visitors and expired members, persists private chat and forum, respects blocks",async()=>{
 const db=new DatabaseSync(":memory:"),now=Math.floor(Date.now()/1000);db.exec(fs.readFileSync("workers/brua1-music-network/schema.sql","utf8"));
 const tokenA="a".repeat(64),tokenB="b".repeat(64),tokenExpired="c".repeat(64);
 for(const [id,t,expiry] of [["a",tokenA,now+600],["b",tokenB,now+600],["c",tokenExpired,now-1]]){
  db.prepare("INSERT INTO network_members VALUES(?,?,'ACTIVE',?)").run(id,"Member "+id,now);
  db.prepare("INSERT INTO network_memberships VALUES(?,NULL,'ACTIVE',?,?)").run(id,expiry,now);
  db.prepare("INSERT INTO network_sessions VALUES(?,?,?,NULL)").run(createHash("sha256").update(t).digest("hex"),id,now+600);
 }
 const adapter={prepare(sql){return{bind(...args){const s=db.prepare(sql);return{first:async()=>s.get(...args)||null,all:async()=>({results:s.all(...args)}),run:async()=>({meta:{changes:Number(s.run(...args).changes)}})}}}},batch:async statements=>{db.exec("BEGIN");try{const r=[];for(const s of statements)r.push(await s.run());db.exec("COMMIT");return r;}catch(e){db.exec("ROLLBACK");throw e;}}};
 const env={NETWORK_MEMBER_API_ENABLED:"true",NETWORK_DB:adapter};
 const req=(p,token=tokenA,body)=>new Request("https://network.example/api/network/"+p,{method:body?"POST":"GET",headers:{Origin:"https://brua1.com",Authorization:"Bearer "+token,...(body?{"Content-Type":"application/json"}:{})},...(body?{body:JSON.stringify(body)}:{})});
 const call=(p,t,b)=>networkRoute(req(p,t,b),env);
 assert.equal((await networkRoute(req("channels"),{...env,NETWORK_MEMBER_API_ENABLED:"false"})).status,503);
 assert.equal((await call("channels","invalid")).status,401);assert.equal((await call("channels",tokenExpired)).status,401);
 assert.equal((await call("profile",tokenA,{displayName:"Test Producer",roles:["producer","musician"],genres:"Hip-hop",instruments:"Guitar",available:true,directoryVisible:true})).status,200);
 assert.equal((await (await call("directory?role=musician&q=guitar",tokenB)).json()).profiles.length,1);
 const mixed={displayName:"Test Producer and Carpenter",roles:["producer","carpenter","contractor"],location:"Monroe, LA",instruments:"Trim and framing",available:true,directoryVisible:true};
 assert.equal((await call("profile",tokenA,mixed)).status,200);
 assert.deepEqual((await (await call("profile",tokenA)).json()).roles,["carpenter","contractor","producer"]);
 assert.equal((await (await call("directory?role=carpenter&q=framing",tokenB)).json()).profiles.length,1);
 assert.equal((await (await call("directory?q=contractor",tokenB)).json()).profiles.length,1);
 assert.equal((await call("profile",tokenA,{...mixed,roles:["painter"]})).status,200);
 assert.deepEqual((await (await call("profile",tokenA)).json()).roles,["painter"]);
 assert.equal((await (await call("directory?role=painter",tokenB)).json()).profiles.length,1);
 assert.equal((await call("profile",tokenA,{...mixed,roles:["plumber"]})).status,400);
 assert.equal((await call("directory?role=plumber",tokenB)).status,400);
 assert.equal((await call("profile",tokenA,{...mixed,roles:["motivational_speaker","finish_carpenter","producer"]})).status,200);
 assert.deepEqual((await (await call("profile",tokenA)).json()).roles,["finish_carpenter","motivational_speaker","producer"]);
 assert.equal((await (await call("directory?role=motivational_speaker",tokenB)).json()).profiles.length,1);
 assert.equal((await call("profile",tokenA,mixed)).status,200);
 assert.equal((await call("profile",tokenExpired,mixed)).status,401);
 assert.equal((await call("profile",tokenA,{...mixed,roles:["invalid"]})).status,400);
 assert.equal((await call("profile",tokenA,{...mixed,directoryVisible:false})).status,200);
 assert.equal((await (await call("directory?role=carpenter",tokenB)).json()).profiles.length,0);
 assert.equal((await call("profile",tokenA,mixed)).status,200);
 assert.equal((await call("chat",tokenA,{channel:"general",body:"Hello from member A"})).status,201);
 assert.equal((await (await call("chat?channel=general",tokenB)).json()).messages[0].body,"Hello from member A");
 const thread=await (await call("threads",tokenA,{channel:"collaborations",title:"Find a guitarist",body:"Original music project"})).json();
 assert.ok(thread.id);assert.equal((await call("posts",tokenB,{thread:thread.id,body:"Interested!"})).status,201);
 assert.equal((await (await call("posts?thread="+thread.id,tokenB)).json()).posts.length,2);
 assert.equal((await call("block",tokenB,{memberId:"a"})).status,200);
 assert.equal((await (await call("chat?channel=general",tokenB)).json()).messages.length,0);
 assert.equal((await (await call("directory",tokenB)).json()).profiles.length,0);
 assert.equal((await call("posts?thread="+thread.id,tokenB)).status,404);
 db.close();
});

test("single-use invitation issues random access key and session; login and logout work; no paid entitlement created",async()=>{
 const db=new DatabaseSync(":memory:"),now=Math.floor(Date.now()/1000);db.exec(fs.readFileSync("workers/brua1-music-network/schema.sql","utf8"));
 const raw="d".repeat(64),hash=createHash("sha256").update(raw).digest("hex");
 db.prepare("INSERT INTO network_members VALUES(?,?,'INVITED',?)").run("invited","Private beta member",now);
 db.prepare("INSERT INTO network_invites VALUES(?,?,?,NULL)").run(hash,"invited",now+60);
 const adapter={prepare(sql){return{bind(...args){const s=db.prepare(sql);return{first:async()=>s.get(...args)||null,all:async()=>({results:s.all(...args)}),run:async()=>({meta:{changes:Number(s.run(...args).changes)}})}}}},batch:async statements=>{db.exec("BEGIN");try{const r=[];for(const s of statements)r.push(await s.run());db.exec("COMMIT");return r;}catch(e){db.exec("ROLLBACK");throw e;}}};
 const result=await redeemInvite(adapter,raw,now);assert.match(result.accessKey,/^[a-f0-9]{64}$/);assert.match(result.sessionToken,/^[a-f0-9]{64}$/);
 assert.equal(await redeemInvite(adapter,raw,now),null);
 assert.notEqual(db.prepare("SELECT key_hash FROM network_login_keys").get().key_hash,result.accessKey);
 assert.equal(db.prepare("SELECT COUNT(*) AS n FROM network_memberships").get().n,0);
 const next=await login(adapter,result.accessKey,now);assert.notEqual(next.sessionToken,result.sessionToken);
 await logout(adapter,next.sessionToken,now);assert.equal(db.prepare("SELECT revoked_at FROM network_sessions WHERE token_hash=?").get(createHash("sha256").update(next.sessionToken).digest("hex")).revoked_at,now);
 const req=new Request("https://network.example/api/network/channels",{headers:{Origin:"https://brua1.com",Authorization:"Bearer "+result.sessionToken}});
 assert.equal((await networkRoute(req,{NETWORK_DB:adapter,NETWORK_MEMBER_API_ENABLED:"true"})).status,401);
 assert.equal(await login(adapter,"f".repeat(64),now),null);
 db.close();
});

test("full subscription route flow: invitation, unpaid denial, provider approval, verified payment, chat, cancellation, expiry",async()=>{
 const db=new DatabaseSync(":memory:");db.exec(fs.readFileSync("workers/brua1-music-network/schema.sql","utf8"));const now=Math.floor(Date.now()/1000);
 const plan="P-"+"A".repeat(24),sub="I-TEST123456",invite="e".repeat(64);
 db.prepare("INSERT INTO network_members VALUES('pilot','Pilot','INVITED',?)").run(now);
 db.prepare("INSERT INTO network_invites VALUES(?,?,?,NULL)").run(createHash("sha256").update(invite).digest("hex"),"pilot",now+3600);
 db.prepare("INSERT INTO network_billing_plans VALUES('monthly',?,499,'USD',1)").run(plan);
 const adapter={prepare(sql){return{bind(...args){const s=db.prepare(sql);return{first:async()=>s.get(...args)||null,all:async()=>({results:s.all(...args)}),run:async()=>({meta:{changes:Number(s.run(...args).changes)}})}}}},batch:async statements=>{db.exec("BEGIN");try{const r=[];for(const s of statements)r.push(await s.run());db.exec("COMMIT");return r;}catch(e){db.exec("ROLLBACK");throw e;}}};
 let phase="APPROVAL_PENDING",customId,created=0;
 const paidAt=new Date((now-20)*1000).toISOString(),next=new Date((now+29*86400)*1000).toISOString();
 const env={NETWORK_MEMBER_API_ENABLED:"true",NETWORK_INVITE_AUTH_ENABLED:"true",NETWORK_BILLING_ENABLED:"true",NETWORK_TERMS_VERSION:"TEST-ONLY",NETWORK_BROKER_KEY:"a".repeat(64),NETWORK_DB:adapter,NETWORK_PAYPAL_SERVICE:{fetch:async(url,opts)=>{
  assert.equal(opts.headers["X-Network-Broker-Key"],env.NETWORK_BROKER_KEY);const x=JSON.parse(opts.body);
  if(x.action==="create"){created++;customId=x.customId;assert.equal(x.planId,plan);return Response.json({id:sub,plan_id:plan,custom_id:customId,status:"APPROVAL_PENDING",links:[{rel:"approve",href:"https://www.paypal.com/webapps/billing/subscriptions?ba_token=fixture"}]});}
  assert.equal(x.subscriptionId,sub);assert.equal(x.customId,customId);assert.equal(x.planId,plan);
  if(x.action==="cancel"){phase="CANCELLED";return Response.json({cancellationRequested:true});}
  const paid=phase!=="APPROVAL_PENDING";
  return Response.json({subscription:{id:sub,plan_id:plan,custom_id:customId,status:phase,billing_info:paid?{failed_payments_count:0,outstanding_balance:{currency_code:"USD",value:"0.00"},last_payment:{time:paidAt,amount:{currency_code:"USD",value:"4.99"}},next_billing_time:next}:{}},transactions:paid?[{id:"TEST-TRANSACTION",status:"COMPLETED",time:paidAt,amount_with_breakdown:{gross_amount:{currency_code:"USD",value:"4.99"}}}]:[]});
 }}};
 const call=(path,token,body)=>networkRoute(new Request("https://network.example/api/network/"+path,{method:body===undefined?"GET":"POST",headers:{Origin:"https://brua1.com",...(token?{Authorization:"Bearer "+token}:{}),...(body===undefined?{}:{"Content-Type":"application/json"})},...(body===undefined?{}:{body:JSON.stringify(body)})}),env);
 const auth=await (await call("auth/redeem",null,{invite})).json(),token=auth.sessionToken;assert.match(token,/^[a-f0-9]{64}$/);
 assert.equal((await call("me",token)).status,401);
 const begin=await call("billing/begin",token,{cycle:"monthly",acceptedTerms:true,termsVersion:"TEST-ONLY"});assert.equal(begin.status,200);assert.equal((await begin.json()).status,"APPROVAL_PENDING");
 const pending=await (await call("billing/refresh",token,{})).json();assert.equal(pending.accessUntil,0);
 assert.equal((await call("chat",token,{channel:"general",body:"blocked"})).status,401);
 // Pending provider approval remains retryable; no duplicate subscription created.
 assert.equal((await call("billing/begin",token,{cycle:"monthly",acceptedTerms:true,termsVersion:"TEST-ONLY"})).status,200);assert.equal(created,1);
 phase="ACTIVE";const paid=await (await call("billing/refresh",token,{})).json();assert.equal(paid.status,"ACTIVE");
 assert.equal((await call("me",token)).status,200);
 assert.equal((await call("chat",token,{channel:"general",body:"Verified test member"})).status,201);
 assert.equal((await (await call("chat?channel=general",token)).json()).messages[0].body,"Verified test member");
 const stopped=await (await call("billing/cancel",token,{confirm:true})).json();assert.equal(stopped.cancellationConfirmed,true);assert.equal(stopped.accessUntil,paid.accessUntil);assert.equal((await call("me",token)).status,200);
 db.prepare("UPDATE network_memberships SET access_until=?").run(now-1);assert.equal((await call("me",token)).status,401);
 db.close();
});

test("free founding signup: consent, bot check, no charges, sign-in, directory, chat, and hard cap",async()=>{
 const db=new DatabaseSync(":memory:");db.exec(fs.readFileSync("workers/brua1-music-network/schema.sql","utf8"));
 const adapter={prepare(sql){return{bind(...args){const s=db.prepare(sql);return{first:async()=>s.get(...args)||null,all:async()=>({results:s.all(...args)}),run:async()=>({meta:{changes:Number(s.run(...args).changes)}})}}}},batch:async statements=>{db.exec("BEGIN");try{const out=[];for(const s of statements)out.push(await s.run());db.exec("COMMIT");return out;}catch(e){db.exec("ROLLBACK");throw e;}}};
 const env={NETWORK_DB:adapter,NETWORK_MEMBER_API_ENABLED:"true",NETWORK_PUBLIC_BETA_ENABLED:"true",NETWORK_BILLING_ENABLED:"false",NETWORK_BETA_MODERATION_READY:"true",TURNSTILE_SITE_KEY:"fixture-site-key",TURNSTILE_SECRET_KEY:"fixture-secret"};
 const call=(p,body,token,override={})=>networkRoute(new Request("https://network.example/api/network/"+p,{method:body===undefined?"GET":"POST",headers:{Origin:"https://brua1.com",...(token?{Authorization:"Bearer "+token}:{}),...(body===undefined?{}:{"Content-Type":"application/json"})},...(body===undefined?{}:{body:JSON.stringify(body)})}),{...env,...override},{verifyChallenge:async(e,t)=>t==="human"});
 const input={displayName:"Founding carpenter",adultConfirmed:true,acceptedTerms:true,termsVersion:"BRUA1-FOUNDING-BETA-V1",challengeToken:"human"};
 assert.equal((await call("auth/register",input,null,{NETWORK_PUBLIC_BETA_ENABLED:"false"})).status,503);
 assert.equal((await call("auth/register",input,null,{NETWORK_BETA_MODERATION_READY:"false"})).status,503);
 assert.equal((await call("auth/register",{...input,challengeToken:"bot"})).status,403);
 assert.equal((await call("auth/register",{...input,acceptedTerms:false})).status,400);
 const result=await call("auth/register",input);assert.equal(result.status,201);const a=await result.json();assert.match(a.accessKey,/^[a-f0-9]{64}$/);
 assert.equal((await (await call("me",undefined,a.sessionToken)).json()).freeBeta,true);
 assert.equal((await call("billing/config")).status,503);
 assert.equal(db.prepare("SELECT COUNT(*) AS n FROM network_enrollments").get().n,0);
 assert.equal(db.prepare("SELECT COUNT(*) AS n FROM network_subscription_ledger").get().n,0);
 assert.equal((await call("profile",{displayName:input.displayName,roles:["carpenter"],available:true,directoryVisible:true},a.sessionToken)).status,200);
 assert.equal((await call("chat",{channel:"general",body:"Hello founders"},a.sessionToken)).status,201);
 assert.equal((await call("auth/logout",{},a.sessionToken)).status,200);
 assert.equal((await call("me",undefined,a.sessionToken)).status,401);
 const login=await (await call("auth/login",{accessKey:a.accessKey},null,{NETWORK_PUBLIC_BETA_ENABLED:"false"})).json();assert.ok(login.sessionToken);
 assert.equal((await call("me",undefined,login.sessionToken)).status,200);
 for(let i=1;i<50;i++)assert.equal((await call("auth/register",{...input,displayName:"Fixture "+i})).status,201);
 const stats=await (await call("beta/config")).json();assert.equal(stats.registered,50);assert.equal(stats.listed,1);assert.equal(stats.spotsRemaining,0);assert.equal(stats.reviewDue,true);
 assert.equal((await call("auth/register",input)).status,409);
 assert.equal((await call("me",undefined,login.sessionToken)).status,200);
 db.close();
});

 test("PayPal payment management is hidden by default and never shown to free founding members",()=>{const html=fs.readFileSync("music-network.html","utf8"),js=fs.readFileSync("music-network.js","utf8");assert.match(html,/<p id="paypal-payment-management"[^>]*\bhidden\b[^>]*><a href="https:\/\/www\.paypal\.com\/myaccount\/autopay\//);assert.match(js,/by\("paypal-payment-management"\)\.hidden=!\(health\?\.billingEnabled===true&&config&&!me\.freeBeta\)/);assert.match(js,/function lockWorkspace\(\)\{stopChat\(\);by\("paypal-payment-management"\)\.hidden=true/);});

test("homepage hub connects to existing protected member channels and published learning center",()=>{const home=fs.readFileSync("index.html","utf8"),learn=fs.readFileSync("learning-center.html","utf8"),hub=fs.readFileSync("hub.js","utf8"),network=fs.readFileSync("music-network.js","utf8"),allow=fs.readFileSync(".assetsignore","utf8");for(const id of ["general","producers","education","collaborations","opportunities","feedback"])assert(home.includes("music-network.html?channel="+id+"#member-account"));assert(home.includes('href="learning-center.html"'));assert(home.includes('id="hub-member-count"'));assert.equal([...learn.matchAll(/data-video="([A-Za-z0-9_-]{11})"/g)].length,6);assert(!learn.includes("<iframe"));assert(hub.includes("https://www.youtube-nocookie.com/embed/"));assert(network.includes("r.channels.find(c=>c.id===requestedChannel)"));assert(learn.includes("As an Amazon Associate I earn from qualifying purchases."));for(const p of ["learning-center.html","hub.css","hub.js"])assert(allow.includes("!"+p));new Script(hub);});
