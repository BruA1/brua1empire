import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const read=p=>JSON.parse(readFileSync(new URL(p,import.meta.url),"utf8"));
const manifest=read("../fulfillment/license-v3-sku-manifest.json");
const staged=read("../catalog/store-skus-staging.json");
test("RC v3 associates each staged SKU with the correct track-specific publishing schedule",()=>{
  const schedules=new Map(manifest.track_publishing_schedules.map(s=>[s.product_id,s]));
  const skus=new Map(staged.skus.map(s=>[s.sku,s]));
  assert.equal(schedules.size,36);
  assert.equal(manifest.track_publishing_schedules.length,36);
  assert.equal(manifest.sku_agreement_links.length,108);
  assert.equal(new Set(manifest.sku_agreement_links.map(s=>s.sku)).size,108);
  for(const link of manifest.sku_agreement_links){
    const original=skus.get(link.sku),schedule=schedules.get(link.product_id);
    assert.ok(original&&schedule);
    assert.equal(link.product_id,original.product_id);
    assert.equal(link.publishing_schedule_id,schedule.schedule_id);
    assert.equal(link.tier,original.tier);
    assert.equal(link.price_cents,original.price_cents);
    assert.deepEqual(link.formats,original.files);
    assert.equal(link.agreement_version,manifest.agreement_version);
    assert.ok(!manifest.held_products.includes(link.product_id));
  }
});
test("owner declarations cannot be mistaken for finalized schedules or live entitlements",()=>{
  assert.equal(manifest.llc_required_for_launch,false);
  assert.equal(manifest.owner_rights_declaration.status,"OWNER_CONFIRMED");
  assert.equal(manifest.owner_rights_declaration.independent_clearance_verified,false);
  assert.equal(manifest.agreement_final_sha256,null);
  assert.equal(manifest.checkout_enabled,false);
  assert.equal(manifest.issuance_enabled,false);
  for(const s of manifest.track_publishing_schedules){
    assert.equal(s.status,"PENDING_AGREEMENT");
    assert.equal(s.writer_shares,null);
    assert.equal(s.publisher_shares,null);
    assert.equal(s.checkout_enabled,false);
    assert.equal(s.version,null);
    assert.equal(s.sha256,null);
  }
  assert.ok(manifest.sku_agreement_links.every(s=>s.issuance_enabled===false));
});
