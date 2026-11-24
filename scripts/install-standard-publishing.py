"""Install owner-authorized 50/50 schedules; do not enable payments or rights flags."""
import hashlib,json,os,pathlib,re,urllib.request,urllib.error
account=os.environ["CLOUDFLARE_ACCOUNT_ID"]
token=os.environ["CLOUDFLARE_D1_API_TOKEN"]
base="https://api.cloudflare.com/client/v4/accounts/"+account+"/d1/database"
def call(url,data=None):
 req=urllib.request.Request(url,data=None if data is None else json.dumps(data).encode(),headers={"Authorization":"Bearer "+token,"Content-Type":"application/json"})
 try:
  with urllib.request.urlopen(req,timeout=30) as r: x=json.load(r)
 except urllib.error.HTTPError as e: raise RuntimeError("D1 API HTTP "+str(e.code)) from None
 assert x["success"]
 return x["result"]
dbs=[d for d in call(base+"?name=brua1-orders-production") if d["name"]=="brua1-orders-production"]
assert len(dbs)==1 and re.fullmatch(r"aaf4b1d0-7d1b-437a-[0-9a-f]{4}-[0-9a-f]{12}",dbs[0]["uuid"])
url=base+"/"+dbs[0]["uuid"]+"/query"
def query(sql,params=[]):
 r=call(url,{"sql":sql,"params":params})
 assert all(x["success"] for x in r)
 return r[-1].get("results",[])
manifest=json.loads(pathlib.Path("fulfillment/license-v5-sku-manifest.json").read_text())
assert manifest["checkout_enabled"] is False and manifest["issuance_enabled"] is False
assert manifest["publishing_split_status"]=="STANDARD_50_50_OWNER_AUTHORIZED__FINAL_RELEASE_PENDING"
schedules=manifest["track_publishing_schedules"]
assert len(schedules)==36 and len(manifest["sku_agreement_links"])==108
assert all(s["writer_shares"]=={"brua1_percent":50,"licensee_side_percent":50} and s["publisher_shares"]=={"brua1_side_percent":50,"licensee_side_percent":50} and s["checkout_enabled"] is False for s in schedules)
assert {r["product_id"] for r in query("SELECT product_id FROM commerce_products WHERE sale_enabled=0")}=={s["product_id"] for s in schedules}
assert query("SELECT COUNT(*) AS n FROM commerce_orders")[0]["n"]==0
rows=[]
for s in schedules:
 doc=s["schedule_document"]
 rows.append((s["product_id"],s["version"],hashlib.sha256(doc.encode()).hexdigest(),doc))
existing=query("SELECT product_id,schedule_version,schedule_sha256 FROM commerce_publishing_schedules")
expected={(p,v,h) for p,v,h,d in rows}
assert all((r["product_id"],r["schedule_version"],r["schedule_sha256"]) in expected for r in existing)
for i in range(0,len(rows),10):
 chunk=rows[i:i+10]
 query("INSERT INTO commerce_publishing_schedules(product_id,schedule_version,schedule_sha256,schedule_document,approved_at) VALUES "+",".join(["(?,?,?,?,'2026-11-23')"]*len(chunk))+" ON CONFLICT(product_id,schedule_version,schedule_sha256) DO NOTHING",[x for row in chunk for x in row])
actual=query("SELECT product_id,schedule_version,schedule_sha256,schedule_document FROM commerce_publishing_schedules")
assert {(r["product_id"],r["schedule_version"],r["schedule_sha256"]) for r in actual}==expected
assert all(hashlib.sha256(r["schedule_document"].encode()).hexdigest()==r["schedule_sha256"] for r in actual)
assert query("SELECT COUNT(*) AS n FROM commerce_products WHERE sale_enabled=1")[0]["n"]==0
print("VERIFIED: 36 owner-authorized 50/50 schedules installed and hashed; 108 candidate SKUs; zero active sales.")
