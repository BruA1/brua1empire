"""Resolve the owner-created D1 by exact name and known ID prefix; write locked deploy config."""
import os,json,urllib.request,pathlib,re,sys
mode=sys.argv[1]
assert mode in ("checkout","delivery")
account=os.environ["CLOUDFLARE_ACCOUNT_ID"]
token=os.environ["CLOUDFLARE_D1_API_TOKEN"]
req=urllib.request.Request("https://api.cloudflare.com/client/v4/accounts/"+account+"/d1/database?name=brua1-orders-production",headers={"Authorization":"Bearer "+token})
with urllib.request.urlopen(req,timeout=30) as r: payload=json.load(r)
matches=[d for d in payload["result"] if d["name"]=="brua1-orders-production"]
assert payload["success"] and len(matches)==1
uuid=matches[0]["uuid"]
assert re.fullmatch(r"aaf4b1d0-7d1b-437a-[0-9a-f-]{18}",uuid)
path=pathlib.Path("workers/"+("brua1-checkout-production" if mode=="checkout" else "brua1-licensed-delivery")+"/wrangler.toml")
config=path.read_text()
assert not re.search(r"^\[\[(?:d1_databases|r2_buckets)\]\]|^route\s*=",config,re.M)
flags=["LIVE_CHECKOUT_ENABLED","LICENSE_ISSUANCE_ENABLED","REAL_AUDIO_DELIVERY_ENABLED"] if mode=="checkout" else ["LIVE_DELIVERY_ENABLED","OWNER_FINAL_GO_LIVE_SIGNOFF"]
assert all(f+' = "false"' in config for f in flags)
config+='\n[[d1_databases]]\nbinding = "ORDERS_DB"\ndatabase_name = "brua1-orders-production"\ndatabase_id = "'+uuid+'"\n'
if mode=="delivery": config+='\n[[r2_buckets]]\nbinding = "INSTRUMENTAL_MASTERS"\nbucket_name = "brua1-instrumentals-masters"\n'
path.with_name("wrangler.bound.toml").write_text(config)
print("Generated locked production storage configuration; no checkout or delivery enabled")
