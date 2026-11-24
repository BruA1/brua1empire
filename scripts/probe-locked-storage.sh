#!/usr/bin/env bash
set -euo pipefail
mode="$1"
if [ "$mode" = checkout ]; then
 config=workers/brua1-checkout-production/wrangler.bound.toml
 url=https://brua1-checkout-production.a1productions0527.workers.dev
elif [ "$mode" = delivery ]; then
 config=workers/brua1-licensed-delivery/wrangler.bound.toml
 url=https://brua1-licensed-delivery-stage.a1productions0527.workers.dev
else exit 1; fi
nonce="$(date -u +%s%3N).$(openssl rand -hex 32)"
echo "::add-mask::$nonce"
installed=0
cleanup() {
 status=$?
 trap - EXIT
 if [ "$installed" = 1 ]; then
  printf 'y\n' | npx --yes wrangler@4 secret delete STORAGE_PROBE_NONCE --config "$config" >/dev/null || status=1
 fi
 exit "$status"
}
trap cleanup EXIT
printf '%s' "$nonce" | npx --yes wrangler@4 secret put STORAGE_PROBE_NONCE --config "$config" >/dev/null
installed=1
for attempt in 1 2 3 4 5 6; do
 response="$(curl --silent --show-error --max-time 20 -X POST -H "Authorization: Bearer $nonce" "$url/internal/verify-storage")"
 if RESPONSE="$response" MODE="$mode" python3 -c 'import os,json,sys; x=json.loads(os.environ["RESPONSE"]); sys.exit(0 if x.get("verified") is True and x.get("databaseVerified") is True and x.get("paymentsEnabled") is False and x.get("deliveryEnabled") is False and (os.environ["MODE"]=="checkout" or x.get("privateBucketReachable") is True) else 1)'; then
  echo "VERIFIED: $mode Worker bound to production D1; payment/delivery locked."
  if [ "$mode" = delivery ]; then echo "VERIFIED: private R2 bucket reachable; no master released."; fi
  exit 0
 fi
 sleep 4
done
echo "::error::Locked storage probe did not pass"
exit 1
