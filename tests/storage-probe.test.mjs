import test from "node:test";
import assert from "node:assert/strict";
import {probeStorage} from "../fulfillment/storage-probe.mjs";
const nonce=Date.now()+"."+"a".repeat(64);
const req=(value=nonce)=>new Request("https://test.invalid/internal/verify-storage",{method:"POST",headers:{Authorization:"Bearer "+value}});
const env={STORAGE_PROBE_NONCE:nonce,LIVE_CHECKOUT_ENABLED:"false",LICENSE_ISSUANCE_ENABLED:"false",REAL_AUDIO_DELIVERY_ENABLED:"false",LIVE_DELIVERY_ENABLED:"false",OWNER_FINAL_GO_LIVE_SIGNOFF:"false",ORDERS_DB:{prepare:()=>({first:async()=>({total:36,disabled:36})})},INSTRUMENTAL_MASTERS:{list:async()=>({objects:[{key:"PRIVATE_TEST"}]})}};
test("authenticated locked storage probe verifies only metadata and never exposes keys",async()=>{for(const mode of [false,true]){const r=await probeStorage(req(),env,mode);assert.equal(r.status,200);const s=await r.text();assert.ok(!s.includes("PRIVATE_TEST"));assert.equal(JSON.parse(s).verified,true);}});
test("unauthorized, unlocked and unavailable storage fail closed",async()=>{assert.equal((await probeStorage(req("bad"),env,true)).status,401);assert.equal((await probeStorage(req(),{...env,LIVE_DELIVERY_ENABLED:"true"},true)).status,503);assert.equal((await probeStorage(req(),{...env,ORDERS_DB:null},false)).status,503);});
