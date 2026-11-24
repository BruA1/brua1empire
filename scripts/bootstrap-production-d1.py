"""Bootstrap ONLY owner-created production D1, with disabled catalog and verified readback."""
import json, os, pathlib, sqlite3, urllib.request, urllib.error, re, sys
NAME="brua1-orders-production"
PREFIX="aaf4b1d0-7d1b-437a"
EXPECTED={"commerce_products","commerce_audio_assets","commerce_orders","commerce_terms_acceptance","commerce_licenses","commerce_download_grants","commerce_publishing_schedules","commerce_publishing_acceptance"}
account=os.environ.get("CLOUDFLARE_ACCOUNT_ID","")
token=os.environ.get("CLOUDFLARE_D1_API_TOKEN","")
if not account or not token: sys.exit("Missing scoped Cloudflare account/D1 credentials")
base="https://api.cloudflare.com/client/v4/accounts/"+account+"/d1/database"
def call(url, data=None):
    req=urllib.request.Request(url, data=None if data is None else json.dumps(data).encode(), headers={"Authorization":"Bearer "+token,"Content-Type":"application/json"})
    try:
        with urllib.request.urlopen(req,timeout=30) as resp: payload=json.load(resp)
    except urllib.error.HTTPError as e: sys.exit("Cloudflare D1 API HTTP "+str(e.code)+"; no credential or response body logged")
    if not payload.get("success"): sys.exit("Cloudflare rejected D1 operation")
    return payload
dbs=call(base+"?name="+NAME)["result"]
matches=[d for d in dbs if d.get("name")==NAME]
if len(matches)!=1: sys.exit("Production database name did not resolve uniquely")
dbid=matches[0].get("uuid","")
if not re.fullmatch(r"[0-9a-f-]{36}",dbid) or not dbid.startswith(PREFIX): sys.exit("Database ID does not match owner screenshot; refusing writes")
def query(sql,params=None):
    obj={"sql":sql}
    if params is not None: obj["params"]=params
    r=call(base+"/"+dbid+"/query",obj)["result"]
    if not r or not all(x.get("success") for x in r): sys.exit("D1 query failed")
    return r[-1].get("results",[])
def statements(path):
    buf=""
    for line in pathlib.Path(path).read_text().splitlines():
        if line.strip().startswith("--"): continue
        buf+=line+"\n"
        if sqlite3.complete_statement(buf):
            s=buf.strip();buf=""
            if s and not s.upper().startswith("PRAGMA"): yield s
    if buf.strip(): raise ValueError("Incomplete SQL statement")
def tables():
    return {r["name"] for r in query("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%'")}
def count(table):
    return query("SELECT COUNT(*) AS n FROM "+table)[0]["n"]
existing=tables()
if existing-EXPECTED: sys.exit("Unexpected tables; refusing migration")
for t in existing-{"commerce_products"}:
    if count(t)!=0: sys.exit("Database has existing transaction/asset/terms records; refusing bootstrap")
if "commerce_products" in existing and query("SELECT COUNT(*) AS n FROM commerce_products WHERE sale_enabled<>0 OR rights_cleared<>0 OR independent_qa_pass<>0")[0]["n"]: sys.exit("Active product records found; refusing bootstrap")
catalog=json.loads(pathlib.Path("catalog/store-skus-staging.json").read_text())
held={"BRUA1-INS-0004","BRUA1-INS-0019","BRUA1-INS-0026"}
products={}
for s in catalog["skus"]:
    if s["product_id"] in held or s["checkout_enabled"] or s["fulfillment_enabled"] or s["rights_cleared"]: sys.exit("Unsafe staging SKU")
    products[s["product_id"]]=s["title"]
assert len(products)==36 and len(catalog["skus"])==108
if "commerce_products" in existing:
    for row in query("SELECT product_id,title FROM commerce_products"):
        if products.get(row["product_id"])!=row["title"]: sys.exit("Unexpected existing product; refusing bootstrap")
for path in ("fulfillment/commerce-schema-staging.sql","fulfillment/publishing-schedules-staging.sql"):
    for sql in statements(path):
        if not sql.upper().startswith(("CREATE TABLE IF NOT EXISTS","CREATE INDEX IF NOT EXISTS","CREATE TRIGGER IF NOT EXISTS")): sys.exit("Unexpected migration SQL")
        query(sql)
# Single atomic insert with parameterized values; never overwrites prior data.
rows=sorted(products.items())
for i in range(0,len(rows),12):
    group=rows[i:i+12]
    query("INSERT INTO commerce_products(product_id,title,launch_group,sale_enabled,rights_cleared,independent_qa_pass) VALUES "+",".join(["(?,?,'BATCH_36',0,0,0)"]*len(group))+" ON CONFLICT(product_id) DO NOTHING",[v for row in group for v in row])
assert tables()==EXPECTED
actual={r["product_id"]:r["title"] for r in query("SELECT product_id,title FROM commerce_products")}
assert actual==products
assert query("SELECT COUNT(*) AS n FROM commerce_products WHERE sale_enabled<>0 OR rights_cleared<>0 OR independent_qa_pass<>0")[0]["n"]==0
assert all(count(t)==0 for t in EXPECTED-{"commerce_products"})
triggers={r["name"] for r in query("SELECT name FROM sqlite_master WHERE type='trigger'")}
assert {"commerce_publishing_acceptance_product_guard","commerce_publishing_acceptance_immutable","commerce_publishing_schedule_immutable"}.issubset(triggers)
print("VERIFIED: brua1-orders-production; 8 commerce tables, 36 disabled products, 0 orders/licenses/assets/grants, publishing guards installed. Sandbox untouched; no live payments.")
