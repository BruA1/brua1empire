"""Generate an explicit free-beta configuration for the existing community Worker.
Read-only checks of existing bindings, database and widget. Never log secret values.
No D1 creation, migrations, resets, payments, or PayPal changes."""
import os,json,re,pathlib,urllib.request,urllib.error
account=os.environ["CLOUDFLARE_ACCOUNT_ID"]
assert re.fullmatch(r"[a-f0-9]{32}",account)
base="https://api.cloudflare.com/client/v4/accounts/"+account
def call(path,token,body=None):
    req=urllib.request.Request(base+path,data=None if body is None else json.dumps(body).encode(),headers={"Authorization":"Bearer "+token,"Content-Type":"application/json"})
    try:
        with urllib.request.urlopen(req,timeout=30) as r: x=json.load(r)
    except urllib.error.HTTPError as e: raise RuntimeError("Cloudflare read/check failed: HTTP "+str(e.code)) from None
    assert x.get("success") is True
    return x["result"]
api=os.environ["CLOUDFLARE_API_TOKEN"]; d1=os.environ["CLOUDFLARE_D1_API_TOKEN"]
worker="/workers/scripts/brua1-music-network"
secrets={x["name"] for x in call(worker+"/secrets",api)}
assert {"NETWORK_BROKER_KEY","TURNSTILE_SECRET_KEY"}<=secrets,"Missing existing encrypted Worker secrets; no release"
settings=call(worker+"/settings",api)
bindings={x["name"]:x for x in settings["bindings"]}
site=bindings.get("TURNSTILE_SITE_KEY",{}).get("text")
if not site:
    widgets=call("/challenges/widgets?per_page=100&page=1",api)
    found=[w for w in widgets if w.get("name")=="BruA1 Founding Signup" and w.get("mode")=="managed" and "brua1.com" in w.get("domains",[])]
    assert len(found)==1,"Existing managed widget not uniquely found"
    site=found[0]["sitekey"]
assert re.fullmatch(r"[A-Za-z0-9_-]{10,100}",site),"Invalid public widget key"
matches=[d for d in call("/d1/database?name=brua1-music-network",d1) if d["name"]=="brua1-music-network"]
assert len(matches)==1
uuid=matches[0]["uuid"]
assert re.fullmatch(r"[0-9a-f-]{36}",uuid) and not uuid.startswith("aaf4b1d0-7d1b-437a")
def query(sql):
    r=call("/d1/database/"+uuid+"/query",d1,{"sql":sql})
    assert all(x["success"] for x in r)
    return r[-1].get("results",[])
required=set("network_members network_memberships network_sessions network_profiles network_roles network_service_roles network_focused_roles network_channels network_threads network_posts network_chat_messages network_blocks network_reports network_dm network_invites network_founding_members network_login_keys network_billing_plans network_enrollments network_subscription_ledger".split())
assert required<={r["name"] for r in query("SELECT name FROM sqlite_master WHERE type='table'")}
assert query("SELECT COUNT(*) AS n FROM network_channels")[0]["n"]==10
count=query("SELECT COUNT(*) AS n FROM network_founding_members")[0]["n"]
assert count==0,"Existing founders detected; do not rerun initial launch deployment"
p=pathlib.Path("workers/brua1-music-network/wrangler.toml")
conf=p.read_text()
assert "keep_vars" not in conf and "[[d1_databases]]" not in conf and "[[services]]" not in conf
conf=conf.replace("workers_dev = true","workers_dev = true\nkeep_vars = true")
for flag in ["NETWORK_MEMBER_API_ENABLED","NETWORK_PUBLIC_BETA_ENABLED","NETWORK_BETA_MODERATION_READY"]:
    old=flag+' = "false"'
    assert conf.count(old)==1
    conf=conf.replace(old,flag+' = "true"')
for flag in ["NETWORK_BILLING_ENABLED","NETWORK_INVITE_AUTH_ENABLED"]:
    assert flag+' = "false"' in conf
conf=conf.replace("[vars]","[vars]\nTURNSTILE_SITE_KEY = "+json.dumps(site))
conf+='\n[[d1_databases]]\nbinding = "NETWORK_DB"\ndatabase_name = "brua1-music-network"\ndatabase_id = "'+uuid+'"\n[[services]]\nbinding = "NETWORK_PAYPAL_SERVICE"\nservice = "brua1-checkout-production"\n'
p.with_name("wrangler.beta-release.toml").write_text(conf)
print("VERIFIED: existing isolated database and encrypted secrets; explicit free-beta config; billing and invitations disabled.")
