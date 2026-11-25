"""Create/initialize only the separate empty BruA1 Music Network D1 database."""
import os,json,urllib.request,urllib.error,pathlib,re,sqlite3
name="brua1-music-network"
account=os.environ["CLOUDFLARE_ACCOUNT_ID"]
token=os.environ["CLOUDFLARE_D1_API_TOKEN"]
base="https://api.cloudflare.com/client/v4/accounts/"+account+"/d1/database"
def call(url,data=None):
 req=urllib.request.Request(url,data=None if data is None else json.dumps(data).encode(),headers={"Authorization":"Bearer "+token,"Content-Type":"application/json"})
 try:
  with urllib.request.urlopen(req,timeout=30) as r: x=json.load(r)
 except urllib.error.HTTPError as e: raise RuntimeError("Scoped D1 API returned HTTP "+str(e.code)) from None
 assert x["success"]
 return x["result"]
def find():
 return [d for d in call(base+"?name="+name) if d["name"]==name]
matches=find()
if not matches:
 created=call(base,{"name":name})
 matches=find()
assert len(matches)==1
uuid=matches[0]["uuid"]
assert re.fullmatch(r"[0-9a-f-]{36}",uuid) and not uuid.startswith("aaf4b1d0-7d1b-437a")
def query(sql):
 r=call(base+"/"+uuid+"/query",{"sql":sql})
 assert all(x["success"] for x in r)
 return r[-1].get("results",[])
expected=set("network_members network_memberships network_sessions network_profiles network_roles network_service_roles network_channels network_threads network_posts network_chat_messages network_blocks network_reports network_dm network_invites network_founding_members network_login_keys network_billing_plans network_enrollments network_subscription_ledger".split())
def tables():
 return {r["name"] for r in query("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%'")}
assert not (tables()-expected)
for t in tables()-{"network_channels","network_billing_plans"}:
 assert query("SELECT COUNT(*) AS n FROM "+t)[0]["n"]==0
path=pathlib.Path("workers/brua1-music-network/schema.sql")
buf=""
for line in path.read_text().splitlines():
 if line.strip().startswith("--"):continue
 buf+=line+"\n"
 if sqlite3.complete_statement(buf):
  s=buf.strip();buf=""
  if s.upper().startswith("PRAGMA"):continue
  assert s.upper().startswith(("CREATE TABLE IF NOT EXISTS NETWORK_","CREATE INDEX IF NOT EXISTS NETWORK_","INSERT OR IGNORE INTO NETWORK_CHANNELS"))
  query(s)
assert tables()==expected
assert all(query("SELECT COUNT(*) AS n FROM "+t)[0]["n"]==0 for t in expected-{"network_channels","network_billing_plans"})
assert query("SELECT COUNT(*) AS n FROM network_channels")[0]["n"]==10
p=pathlib.Path("workers/brua1-music-network/wrangler.toml")
conf=p.read_text()
assert all(f+' = "false"' in conf for f in ["NETWORK_MEMBER_API_ENABLED","NETWORK_INVITE_AUTH_ENABLED","NETWORK_BILLING_ENABLED","NETWORK_PUBLIC_BETA_ENABLED","NETWORK_BETA_MODERATION_READY"])
assert "[[d1_databases]]" not in conf and "[[r2_buckets]]" not in conf
p.with_name("wrangler.bound.toml").write_text(conf+'\n[[d1_databases]]\nbinding = "NETWORK_DB"\ndatabase_name = "'+name+'"\ndatabase_id = "'+uuid+'"\n')
with p.with_name("wrangler.bound.toml").open("a") as f:
 f.write('\n[[services]]\nbinding = "NETWORK_PAYPAL_SERVICE"\nservice = "brua1-checkout-production"\n')
print("VERIFIED: separate Music Network D1, 19 tables, 10 channels, zero members or subscriptions. Commerce database untouched.")
