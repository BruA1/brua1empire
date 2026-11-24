import test from "node:test";import assert from "node:assert/strict";import {DatabaseSync} from "node:sqlite";import fs from "node:fs";import {beginEnrollment,refreshEnrollment,cancelEnrollment} from "../workers/brua1-music-network/enrollment.mjs";
test("enrollment requires verified plan and terms, reuses approval, grants only verified paid access",async()=>{
 const db=new DatabaseSync(":memory:");db.exec(fs.readFileSync("workers/brua1-music-network/schema.sql","utf8"));const now=Date.parse("2026-11-24T07:00:00Z")/1000;const plan="P-"+"A".repeat(24);
 db.prepare("INSERT INTO network_members VALUES('m','Test','ACTIVE',?)").run(now);
 db.prepare("INSERT INTO network_billing_plans VALUES('monthly',?,499,'USD',0)").run(plan);
 const adapter={prepare(sql){return{bind(...args){const s=db.prepare(sql);return{first:async()=>s.get(...args)||null,run:async()=>({meta:{changes:Number(s.run(...args).changes)}})}}}},batch:async stmts=>{db.exec("BEGIN");try{const r=[];for(const s of stmts)r.push(await s.run());db.exec("COMMIT");return r}catch(e){db.exec("ROLLBACK");throw e}}};
 let count=0,record;const sub="I-TEST123456";
 let canceled=false;const broker={cancelSubscription:async()=>{canceled=true;return {cancellationRequested:true}},createSubscription:async x=>{count++;record=x;return {id:sub,plan_id:x.planId,custom_id:x.customId,status:"APPROVAL_PENDING",links:[{rel:"approve",href:"https://www.paypal.com/webapps/billing/subscriptions?ba_token=fixture"}]}},readSubscription:async()=>({subscription:{id:sub,plan_id:plan,custom_id:record.customId,status:canceled?"CANCELLED":"ACTIVE",billing_info:{failed_payments_count:0,outstanding_balance:{currency_code:"USD",value:"0.00"},last_payment:{time:"2026-11-24T06:00:00Z",amount:{currency_code:"USD",value:"4.99"}},next_billing_time:"2026-12-24T06:00:00Z"}},transactions:[{id:"T1",time:"2026-11-24T06:00:00Z",status:"COMPLETED",amount_with_breakdown:{gross_amount:{currency_code:"USD",value:"4.99"}}}]})};
 const input={cycle:"monthly",acceptedTerms:true,termsVersion:"V1"};
 await assert.rejects(beginEnrollment(adapter,broker,"m",input,"V1",now));
 db.exec("UPDATE network_billing_plans SET enrollment_enabled=1");
 await assert.rejects(beginEnrollment(adapter,broker,"m",{...input,acceptedTerms:false},"V1",now));
 assert.equal((await beginEnrollment(adapter,broker,"m",input,"V1",now)).status,"APPROVAL_PENDING");
 await beginEnrollment(adapter,broker,"m",input,"V1",now);assert.equal(count,1);
 assert.equal(db.prepare("SELECT COUNT(*) AS n FROM network_memberships").get().n,0);
 const result=await refreshEnrollment(adapter,broker,"m",now);assert.equal(result.status,"ACTIVE");assert.equal(db.prepare("SELECT status FROM network_memberships WHERE member_id='m'").get().status,"ACTIVE");
 const stopped=await cancelEnrollment(adapter,broker,"m",now);assert.equal(stopped.cancellationConfirmed,true);assert.equal(stopped.status,"CANCELED");assert.equal(stopped.accessUntil,result.accessUntil);
 db.close();
});