"""Install verified, inactive PayPal plan IDs in the isolated membership database."""
import os,json,urllib.request,urllib.error,re
data=json.loads(os.environ["NETWORK_RESULT"])
assert data.get("verified") is True and data.get("enrollmentEnabled") is False and data.get("chargesCreated") is False
plans=data["plans"]
assert len(plans)==2 and {p["key"] for p in plans}=={"monthly","annual"}
expected={"monthly":("4.99","MONTH",499),"annual":("49.99","YEAR",4999)}
for p in plans:
 amount,unit,_=expected[p["key"]]
 assert p["status"] in ("CREATED","INACTIVE") and p["amount"]==amount and p["unit"]==unit and re.fullmatch(r"P-[A-Z0-9]{24}",p["id"])
assert len({p["id"] for p in plans})==2
account=os.environ["CLOUDFLARE_ACCOUNT_ID"];token=os.environ["CLOUDFLARE_D1_API_TOKEN"]
base="https://api.cloudflare.com/client/v4/accounts/"+account+"/d1/database"
def call(url,data=None):
 req=urllib.request.Request(url,data=None if data is None else json.dumps(data).encode(),headers={"Authorization":"Bearer "+token,"Content-Type":"application/json"})
 with urllib.request.urlopen(req,timeout=30) as r: x=json.load(r)
 assert x["success"];return x["result"]
matches=[d for d in call(base+"?name=brua1-music-network") if d["name"]=="brua1-music-network"]
assert len(matches)==1
uuid=matches[0]["uuid"]
assert re.fullmatch(r"[0-9a-f-]{36}",uuid) and not uuid.startswith("aaf4b1d0-7d1b-437a")
def query(sql,params=None):
 r=call(base+"/"+uuid+"/query",{"sql":sql,"params":params or []})
 assert all(x["success"] for x in r);return r[-1].get("results",[])
want={p["key"]:(p["id"],expected[p["key"]][2],"USD",0) for p in plans}
def current():
 return {r["cycle"]:(r["provider_plan_id"],r["price_cents"],r["currency"],r["enrollment_enabled"]) for r in query("SELECT * FROM network_billing_plans")}
assert all(want.get(k)==v for k,v in current().items()),"Existing plan mismatch; no replacement permitted"
for cycle,record in want.items():
 query("INSERT INTO network_billing_plans(cycle,provider_plan_id,price_cents,currency,enrollment_enabled) VALUES(?,?,?,?,?) ON CONFLICT(cycle) DO NOTHING",[cycle,*record])
assert current()==want
print("VERIFIED: two actual PayPal plans linked to isolated Music Network database, monthly 499 and annual 4999 cents; enrollment remains disabled.")
