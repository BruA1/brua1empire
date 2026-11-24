/**
 * BruA1 production D1 bootstrap *preparation* — zero live products.
 * Do not run in sandbox D1. This generator produces SQL for a newly created,
 * separately approved production database only after owner inspects it.
 * It inserts 36 track titles with sale_enabled/rights_cleared/QA flags ALL ZERO,
 * and absolutely never inserts an R2 key, license, paid order, grant or credential.
 */
import fs from "node:fs";
import assert from "node:assert/strict";
import {pathToFileURL} from "node:url";

const HOLDS=Object.freeze(["BRUA1-INS-0004","BRUA1-INS-0019","BRUA1-INS-0026"]);
export function prepareDisabledProductSeed(catalog) {
 assert.equal(catalog?.environment,"STAGING_ONLY","Expected staging-only source");
 assert.equal(catalog?.items_in_batch,36,"Expected 36 tracks");
 assert.equal(catalog?.skus_total,108,"Expected 108 tiers");
 assert.equal(catalog?.skus?.length,108,"SKU count mismatch");
 const titles=new Map(),seen=new Set();
 for(const sku of catalog.skus){
   assert.match(sku.product_id||"",/^BRUA1-INS-\d{4}$/);
   assert(!HOLDS.includes(sku.product_id),"Owner-held instrumental included");
   assert(["basic","premium","unlimited"].includes(sku.tier),"Unapproved tier");
   assert.equal(sku.currency,"USD");
   assert.equal(sku.price_cents,{basic:2999,premium:5999,unlimited:9999}[sku.tier]);
   assert.equal(sku.checkout_enabled,false);
   assert.equal(sku.fulfillment_enabled,false);
   assert.equal(sku.rights_cleared,false);
   assert.equal(sku.independently_content_qa_pass,false);
   const key=sku.product_id+":"+sku.tier;
   assert(!seen.has(key),"Duplicate SKU tier");
   seen.add(key);
   if(titles.has(sku.product_id))assert.equal(titles.get(sku.product_id),sku.title);
   else titles.set(sku.product_id,sku.title);
 }
 assert.equal(titles.size,36);
 for(const [id] of titles)for(const tier of ["basic","premium","unlimited"])
   assert(seen.has(id+":"+tier),"Missing tier: "+id+" "+tier);
 const quote=s=>"'"+String(s).replaceAll("'","''")+"'";
 const ordered=[...titles.entries()].sort(([a],[b])=>a.localeCompare(b));
 // No UPDATE on conflict; do not clobber future legitimate production reviews.
 const lines=[
   "-- BRUA1 REVIEW-ONLY PRODUCTION PRODUCT SEED: 36 TRACKS, ALL OFF",
   "-- Production schema must be independently reviewed and installed first.",
   "-- Never apply to sandbox D1. No R2 keys, financial details or license grants.",
   "BEGIN TRANSACTION;",
   ...ordered.map(([id,title])=>
     "INSERT INTO commerce_products(product_id,title,launch_group,sale_enabled,rights_cleared,independent_qa_pass) "+
     "VALUES ("+quote(id)+","+quote(title)+",'BATCH_36',0,0,0) "+
     "ON CONFLICT(product_id) DO NOTHING;"),
   "COMMIT;",
   ""
 ];
 return {sql:lines.join("\n"),productCount:36,holds:[...HOLDS],allDisabled:true};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const c=JSON.parse(fs.readFileSync("catalog/store-skus-staging.json","utf8"));
 process.stdout.write(prepareDisabledProductSeed(c).sql);
}
