import test from "node:test";
import assert from "node:assert/strict";
import {validAudioHeader,auditPrivateAudio} from "../fulfillment/audit-private-audio.mjs";
test("recognizes MP3 and RIFF/WAVE headers, rejects mismatches",()=>{
 const wav=new TextEncoder().encode("RIFF0000WAVE");
 const mp3=new Uint8Array([73,68,51,4,0,0,0,0,0,0,0,0]);
 assert.equal(validAudioHeader("wav",wav),true);assert.equal(validAudioHeader("mp3",mp3),true);
 assert.equal(validAudioHeader("mp3",wav),false);assert.equal(validAudioHeader("wav",mp3),false);
 assert.equal(validAudioHeader("mp3",new Uint8Array(12)),false);
});
test("audit refuses unlocked production",async()=>assert.rejects(auditPrivateAudio({LIVE_CHECKOUT_ENABLED:"true"}),/Release lock/));
