import test from "node:test";
import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
test("isolated publishing schema preserves correct, immutable order-level terms",()=>{
 const result=spawnSync("python3",["-c",`
import pathlib, sqlite3
db=sqlite3.connect(":memory:")
for f in ("fulfillment/commerce-schema-staging.sql","fulfillment/publishing-schedules-staging.sql"):
 db.executescript(pathlib.Path(f).read_text())
db.execute("INSERT INTO commerce_products(product_id,title) VALUES ('A','Test A'),('B','Test B')")
db.execute("INSERT INTO commerce_orders(paypal_order_id,product_id,license_tier,amount_cents,currency,buyer_email,status) VALUES ('TESTORDER','A','basic',2999,'USD','test@example.invalid','CREATED')")
h='a'*64
for p in ('A','B'):
 db.execute("INSERT INTO commerce_publishing_schedules VALUES (?,?,?,?,?)",(p,'TEST-V1',h,'fixture','2026-11-23'))
def rejects(sql,args):
 try:
  db.execute(sql,args)
 except sqlite3.IntegrityError:
  return
 raise AssertionError('Expected integrity error')
insert="INSERT INTO commerce_publishing_acceptance VALUES (?,?,?,?,?)"
rejects(insert,('TESTORDER','B','TEST-V1',h,'2026-11-23'))
rejects(insert,('TESTORDER','A','TEST-V1','b'*64,'2026-11-23'))
db.execute(insert,('TESTORDER','A','TEST-V1',h,'2026-11-23'))
rejects("UPDATE commerce_publishing_acceptance SET accepted_at=? WHERE paypal_order_id=?",('2026-11-24','TESTORDER'))
rejects("UPDATE commerce_publishing_schedules SET schedule_document=? WHERE product_id=?",('changed','A'))
assert db.execute("SELECT COUNT(*) FROM commerce_products WHERE sale_enabled=1").fetchone()[0]==0
print("isolated publishing schema checks passed")
`],{encoding:"utf8"});
 assert.equal(result.status,0,result.stderr||String(result.error));
 assert.match(result.stdout,/checks passed/);
});
