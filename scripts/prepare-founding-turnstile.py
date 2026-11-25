"""Provision only a dedicated Turnstile widget and its two Worker bindings.
No signup, billing, deployment flag or payment change. Never log credentials."""
import json,os,re,urllib.request,urllib.error,time
account=os.environ["CLOUDFLARE_ACCOUNT_ID"]
token=os.environ["CLOUDFLARE_API_TOKEN"]
assert re.fullmatch(r"[a-f0-9]{32}",account)
base="https://api.cloudflare.com/client/v4/accounts/"+account
health="https://brua1-music-network.a1productions0527.workers.dev/health"
def get_health():
    with urllib.request.urlopen(health,timeout=20) as r:
        return json.load(r)
def locked():
    h=get_health()
    assert h.get("databaseReady") and h.get("locked") and not h.get("billingEnabled") and not h.get("memberApiEnabled") and not h.get("publicBetaEnabled")
def call(path,method="GET",data=None):
    req=urllib.request.Request(base+path,method=method,data=None if data is None else json.dumps(data).encode(),headers={"Authorization":"Bearer "+token,"Content-Type":"application/json"})
    try:
        with urllib.request.urlopen(req,timeout=30) as r: x=json.load(r)
    except urllib.error.HTTPError as e: raise RuntimeError("Cloudflare scoped request failed HTTP "+str(e.code)+" at "+path.split("?")[0].split("/")[1]) from None
    assert x.get("success") is True,"Cloudflare operation rejected; check scoped permissions"
    return x
locked()
name="BruA1 Founding Signup"
widgets=[]
for page in range(1,101):
    result=call("/challenges/widgets?per_page=100&page="+str(page))
    items=result["result"]
    assert isinstance(items,list)
    widgets.extend(w for w in items if w.get("name")==name)
    if page>=result.get("result_info",{}).get("total_pages",1):break
else: raise RuntimeError("Widget list incomplete")
assert len(widgets)<=1,"Ambiguous widget; owner review required"
if widgets:
    site=widgets[0]["sitekey"]
    assert re.fullmatch(r"[A-Za-z0-9_-]{10,100}",site)
    w=call("/challenges/widgets/"+site)["result"]
else:
    w=call("/challenges/widgets","POST",{"name":name,"domains":["brua1.com"],"mode":"managed"})["result"]
assert w.get("name")==name and w.get("mode")=="managed" and set(w.get("domains",[]))=={"brua1.com"}
site=w["sitekey"]; secret=w.get("secret")
assert re.fullmatch(r"[A-Za-z0-9_-]{10,100}",site) and isinstance(secret,str) and len(secret)>=20,"Widget secret unavailable; owner must configure it in dashboard"
locked()
path="/workers/scripts/brua1-music-network/secrets"
existing=call(path)["result"]
names={x.get("name") for x in existing}
wanted={"TURNSTILE_SITE_KEY":site,"TURNSTILE_SECRET_KEY":secret}
for key,value in wanted.items():
    if key not in names:
        call(path,"PUT",{"name":key,"text":value,"type":"secret_text"})
# Existing keys are never overwritten blindly. Owner verifies matching pair.
for attempt in range(8):
    try: locked();break
    except Exception:
        if attempt==7:raise
        time.sleep(3)
confirmed={x.get("name") for x in call(path)["result"]}
assert set(wanted)<=confirmed
print("VERIFIED: dedicated managed widget for brua1.com and both Worker binding names present. Signup and billing remain locked. Browser validation and moderation signoff still required.")
