#!/usr/bin/env bash
# Apply migrations, seed tenants/policies/demo data, and save API keys.
# Keys are printed once by the seeder -> deploy/keys.txt and deploy/keys.json
# ({"tenant":"key"}, the loadgen format). Re-running keeps existing keys.
set -euo pipefail
cd "$(dirname "$0")"
DC="docker compose -f compose.prod.yml"
$DC run --rm -T migrate
out=$($DC run --rm -T seed)
echo "$out" | grep -v '^API key for' || true
keys=$(echo "$out" | awk '$1=="API"&&$2=="key"{print $4, $5}')
if [ -n "$keys" ]; then
  umask 077
  # merge: keys are shown once, so never overwrite keys saved by an earlier run
  echo "$out" | grep '^API key for' >> keys.txt
  new=$(echo "$keys" | awk 'BEGIN{printf "{"} {printf "%s\"%s\":\"%s\"", (NR>1?",":""), $1, $2} END{print "}"}')
  if [ -s keys.json ]; then jq -s '.[0] * .[1]' keys.json <(echo "$new") > keys.json.tmp && mv keys.json.tmp keys.json
  else echo "$new" > keys.json; fi
  echo "saved $(echo "$keys" | wc -l) new key(s) to deploy/keys.json (gitignored)"
else
  echo "no new keys (tenants already have one); deploy/keys.json unchanged"
fi
# bulkheadd loads policies at start (seed does not notify it): restart so it sees the tenants.
$DC restart bulkheadd >/dev/null 2>&1 && sleep 3 || true
