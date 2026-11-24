import test from "node:test";import assert from "node:assert/strict";import {provisionNetworkPlans,verifyPlan,PLANS} from "../fulfillment/network-paypal-plans.mjs";
const env={PAYPAL_ENVIRONMENT:"live",LIVE_CHECKOUT_ENABLED:"false",CHECKOUT_ROUTES_ENABLED:"false",NETWORK_SUBSCRIPTION_ENROLLMENT_ENABLED:"false",PAYPAL_CLIENT_ID:"fixture",PAYPAL_CLIENT_SECRET:"fixture"};
test("creates and reads back two non-enrollable plans, idempotent rerun; no subscription or charge",async()=>{
 let product=null;const plans=[];const calls=[];
 async function transport(url,opts){const path=new URL(url).pathname;calls.push(path);const data=opts.body?.startsWith("{")?JSON.parse(opts.body):null;
 if(path.endsWith("/token"))return Response.json({access_token:"fixture"});
 if(path==="/v1/catalogs/products"&&opts.method==="POST"){product=data;return Response.json(product)}
 if(path.startsWith("/v1/catalogs/products/"))return product?Response.json(product):new Response(null,{status:404});
 if(path==="/v1/billing/plans"&&opts.method==="GET")return Response.json({plans,total_pages:1});
 if(path==="/v1/billing/plans"&&opts.method==="POST"){const plan={...data,id:"P-"+String(plans.length+1).padStart(24,"A")};plans.push(plan);return Response.json(plan)}
 if(path.startsWith("/v1/billing/plans/"))return Response.json(plans.find(p=>path.endsWith(p.id)));
 throw Error("Unexpected provider endpoint");
 }
 const result=await provisionNetworkPlans(env,transport);assert.equal(result.verified,true);assert.equal(result.enrollmentEnabled,false);assert.equal(plans.length,2);assert.deepEqual(result.plans.map(p=>p.amount),["4.99","49.99"]);
 await provisionNetworkPlans(env,transport);assert.equal(plans.length,2);assert.ok(!calls.some(x=>x.includes("/subscriptions")||x.includes("/capture")));
 assert.throws(()=>verifyPlan({...plans[0],status:"ACTIVE"},PLANS[0]));await assert.rejects(provisionNetworkPlans({...env,NETWORK_SUBSCRIPTION_ENROLLMENT_ENABLED:"true"},transport));
});