import {networkRoute} from "../workers/brua1-music-network/index.mjs";
import {createHash} from "node:crypto";
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {DatabaseSync} from "node:sqlite";
import {Script} from "node:vm";
test("public preview is linked, honest, and contains no checkout or collection form",()=>{const html=fs.readFileSync("music-network.html","utf8"),home=fs.readFileSync("index.html","utf8"),allow=fs.readFileSync(".assetsignore","utf8");assert(home.includes('href="music-network.html"'));assert(html.includes("Development preview"));assert(html.includes("fictional examples"));assert(!/<form\b|paypal\.com\/|type="password"|type="email"/i.test(html));assert(html.includes("Memberships coming soon"));for(const f of ["music-network.html","music-network.css","music-network.js"])assert(allow.includes("!"+f));assert(!allow.includes("!workers/"));new Script(fs.readFileSync("music-network.js","utf8"));});
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
