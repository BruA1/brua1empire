import fs from "node:fs";
import assert from "node:assert/strict";
import {Script} from "node:vm";

const publicCatalog=JSON.parse(fs.readFileSync("catalog/instrumentals.json","utf8"));
const choices=JSON.parse(fs.readFileSync("catalog/public-license-options.json","utf8"));
const staged=JSON.parse(fs.readFileSync("catalog/store-skus-staging.json","utf8"));
const readiness=JSON.parse(fs.readFileSync("catalog/fulfillment-readiness.json","utf8"));
const page=fs.readFileSync("instrumentals.html","utf8");
const heldIds=new Set(["BRUA1-INS-0004","BRUA1-INS-0019","BRUA1-INS-0026"]);
const tiers={basic:{price:2999,years:5,formats:["mp3"]},premium:{price:5999,years:10,formats:["mp3","wav"]},unlimited:{price:9999,years:10,formats:["mp3","wav"]}};
assert.equal(publicCatalog.checkoutEnabled,false);
assert.equal(readiness.products.filter(p=>p.sale_enabled).length,0);
assert.equal(choices.checkout_enabled,false);
assert.equal(choices.agreement_status,"DRAFT_V2_PENDING_FINAL_REVIEW");
assert.equal(choices.items.length,39);
assert.equal(new Set(choices.items.map(i=>i.id)).size,39);
assert.equal(staged.skus.length,108);
assert.equal(publicCatalog.tracks.length,39);
assert(page.includes('fetch("catalog/instrumentals.json"'));
assert(page.includes('fetch("catalog/public-license-options.json"'));
assert(page.includes('audio.controls=true'),"Playback controls must remain on each track");
assert(page.includes("Request "+'"'+licenseText[option.tier]+" license"'),"Inquiries must be track/tier specific");
assert(page.includes("PayPal checkout coming soon"),"Live checkout must remain disabled");
assert(!page.includes("api-m.paypal.com"),"No production payment client embedded");
const c=new Map(publicCatalog.tracks.map(t=>[t.id,t]));
const l=new Map(readiness.products.map(t=>[t.product_id,t]));
const sku=new Map(staged.skus.map(s=>[s.sku,s]));
let licensed=0,held=0,optionCount=0;
for(const item of choices.items){
  const track=c.get(item.id),inventory=l.get(item.id);
  assert(track&&inventory,"Public license entry maps to existing instrumental: "+item.id);
  assert.equal(item.title,track.title);
  assert.equal(track.listing_status,"licensing_inquiry_only");
  assert.equal(item.checkout_enabled,false);
  assert(typeof track.preview==="string"&&track.preview.endsWith(".mp3"),"Audio preview remains available: "+item.title);
  assert(!/r2_object_key|access[_-]?key|secret|private/i.test(JSON.stringify(item)),"Private storage data must never appear");
  if(heldIds.has(item.id)){
    held++;
    assert.equal(item.availability,"listening_only");
    assert.deepEqual(item.options,[]);
    assert.equal(inventory.owner_hold,true);
    assert.equal(inventory.pilot_batch_candidate,false);
    assert(!staged.skus.some(s=>s.product_id===item.id),"Held track must not have SKU");
  }else{
    licensed++;
    assert.equal(item.availability,"license_options_preview");
    assert.equal(inventory.pilot_batch_candidate,true);
    assert.equal(item.options.length,3);
    assert.equal(inventory.r2_private_mp3_header_pass,true);
    assert.equal(inventory.r2_private_wav_header_pass,true);
    for(const option of item.options){
      optionCount++;
      const expected=tiers[option.tier],record=sku.get(option.sku);
      assert(expected&&record,"Tier must have an exact staged SKU");
      assert.equal(option.sku,item.id+"-"+option.tier.toUpperCase());
      assert.equal(option.price_cents,expected.price);
      assert.equal(option.price_cents,record.price_cents);
      assert.equal(option.duration_years,expected.years);
      assert.deepEqual(option.formats,expected.formats);
      assert.equal(option.currency,"USD");
      assert.equal(option.status,"inquiry_only");
      assert.equal(record.checkout_enabled,false);
      assert.equal(record.fulfillment_enabled,false);
    }
  }
}
assert.equal(licensed,36);
assert.equal(held,3);
assert.equal(optionCount,108);
const allScripts=[...page.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map(x=>x[1]);
for(const body of allScripts) if(body.trim())new Script(body);
console.log("PASS: 39 playable previews unchanged, 36 sets of 3 visible license options, 3 listening-only holds, 108 safe staged SKUs, public checkout OFF.");
