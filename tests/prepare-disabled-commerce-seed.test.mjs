import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {prepareDisabledProductSeed} from "../scripts/prepare-disabled-commerce-seed.mjs";

const catalog=JSON.parse(fs.readFileSync("catalog/store-skus-staging.json","utf8"));
test("36 eligible titles are seeded OFF, all 3 held titles excluded",()=>{
 const prepared=prepareDisabledProductSeed(catalog);
 assert.equal(prepared.productCount,36);
 assert.equal(prepared.allDisabled,true);
 assert.deepEqual(prepared.holds,["BRUA1-INS-0004","BRUA1-INS-0019","BRUA1-INS-0026"]);
 const rows=prepared.sql.split("\n").filter(x=>x.startsWith("INSERT INTO commerce_products("));
 assert.equal(rows.length,36);
 for(const hold of prepared.holds)assert(!prepared.sql.includes(hold));
 for(const row of rows){
   assert.match(row,/'BATCH_36',0,0,0\) ON CONFLICT\(product_id\) DO NOTHING;/);
   assert(!row.includes("UPDATE"),"No future release flag may be overwritten");
 }
 assert(!/r2_object_key|INSERT INTO commerce_orders|download_grants|paypal_client_secret/i.test(prepared.sql));
});
test("refuse invented product, extra SKU, changed price or rights flag",()=>{
 const broken=()=>structuredClone(catalog);
 const injected=broken();injected.skus[0].product_id="BRUA1-INS-0004";
 assert.throws(()=>prepareDisabledProductSeed(injected),/held/);
 const changed=broken();changed.skus[0].price_cents=1;
 assert.throws(()=>prepareDisabledProductSeed(changed));
 const release=broken();release.skus[0].rights_cleared=true;
 assert.throws(()=>prepareDisabledProductSeed(release));
 const duplicate=broken();duplicate.skus[0].tier="premium";
 assert.throws(()=>prepareDisabledProductSeed(duplicate),/Duplicate/);
});
test("escape apostrophes in titles without constructing executable SQL",()=>{
 const special=structuredClone(catalog);
 for(const x of special.skus)if(x.product_id==="BRUA1-INS-0001")x.title="Artist's Test";
 const sql=prepareDisabledProductSeed(special).sql;
 assert.match(sql,/Artist''s Test/);
 assert(!sql.includes("Artist's Test"));
});
