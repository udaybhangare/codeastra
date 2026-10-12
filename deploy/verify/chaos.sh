#!/usr/bin/env bash
# Chaos: kill a tenant worker, stop Redis, stop predictor, saturate Postgres. Each fault is injected
# while a victim (acme-shop echo, 10 rps) is probed; always restores what it stopped.
# Expected degradation modes: docs/02 "Failure behavior". Usage: chaos.sh [PROBE_SECONDS=12]
source "$(dirname "$0")/lib.sh"
D=${1:-12}
PG=bulkhead-postgres-1; RD=bulkhead-redis-1; PR=bulkhead-predictor-1
PGU=$(grep -E '^POSTGRES_USER=' "$DEPLOY/.env" | cut -d= -f2-); PGU=${PGU:-bulkhead}
PGD=$(grep -E '^POSTGRES_DB=' "$DEPLOY/.env" | cut -d= -f2-); PGD=${PGD:-bulkhead}
restore() { docker start "$RD" "$PR" >/dev/null 2>&1; }
trap restore EXIT
field() { python3 -I -c "import json,sys;print(json.loads(sys.argv[1]).get(sys.argv[2]))" "$1" "$2" 2>/dev/null || echo NA; }
allok() { python3 -I -c "import json,sys;d=json.loads(sys.argv[1]);sys.exit(0 if d['sent']>0 and d['ok']==d['sent'] else 1)" "$1" 2>/dev/null; }
echo "== chaos ($BASE, probe ${D}s each)"
b=$(probe acme-shop echo 10 "$D"); echo "  baseline: $b"
allok "$b"; check "baseline: victim 100% OK" "$b" $?

# C1 kill rogue-ml's worker mid-load
probe acme-shop echo 10 "$D" >"$OUT/c1.json" & pp=$!
probe rogue-ml echo 5 "$D" >"$OUT/c1r.json" & pr=$!
sleep 3; docker kill bulkhead-worker-rogue-ml >/dev/null; t0=$(date +%s)
wait $pp $pr; v=$(cat "$OUT/c1.json"); echo "  C1 victim: $v"; echo "  C1 rogue : $(cat "$OUT/c1r.json")"
allok "$v"; check "C1 worker kill: other tenant 0 errors" "$v" $?
rec=0; for i in $(seq 1 40); do [ "$(code -X POST "$BASE/v1/invoke/echo" -H "Authorization: Bearer $(tenant_token rogue-ml)" -d '{}')" = 200 ] && { rec=$(( $(date +%s) - t0 )); break; }; sleep 1; done
[ "$rec" -gt 0 ]; check "C1 killed tenant served again (${rec}s after kill)" "no recovery in 40s" $?
[ "$(docker inspect -f '{{.State.Running}}' bulkhead-worker-rogue-ml 2>/dev/null)" = true ]; check "C1 worker container running again" "not running" $?

# C2 Redis down
docker stop "$RD" >/dev/null; sleep 2
v=$(probe acme-shop echo 10 "$D"); echo "  C2 redis down: $v"
allok "$v"; check "C2 Redis down: requests still served (local buckets)" "$v" $?
n=$(docker logs --since 60s bulkheadd 2>&1 | grep -ci 'redis'); [ "$n" -gt 0 ]; check "C2 degradation is logged ($n redis log lines)" "no redis log line" $?
docker start "$RD" >/dev/null; sleep 5
v=$(probe acme-shop echo 10 4); allok "$v"; check "C2 after Redis restart: OK" "$v" $?

# C3 predictor down
docker stop "$PR" >/dev/null; sleep 1
v=$(probe acme-shop echo 10 "$D"); echo "  C3 predictor down: $v"
allok "$v"; check "C3 predictor down: hot path unaffected" "$v" $?
AT=$(admin_token); st=$(curl -sS "$BASE/admin/predictor" -H "Authorization: Bearer $AT" | head -c 600); echo "  C3 /admin/predictor: $st" | cut -c1-300
echo "$st" | grep -qi 'fallback'; check "C3 detector reports fallback" "no fallback marker in /admin/predictor" $?
docker start "$PR" >/dev/null

# C4 Postgres saturation: 85 of max_connections=100 held by pg_sleep + 8 CPU-burning queries,
# while data-co runs a sorting db-query (n=40000). Compared with the same query before the storm.
q='{"n":40000}'
b4=$(probe data-co db-query 3 6 "$q"); echo "  C4 baseline db-query: $b4"
for i in $(seq 1 85); do docker exec -d "$PG" psql -U "$PGU" -d "$PGD" -qAtc "SELECT pg_sleep(${D}+10)" >/dev/null 2>&1; done
for i in $(seq 1 8); do docker exec -d "$PG" psql -U "$PGU" -d "$PGD" -qAtc "SELECT count(*) FROM generate_series(1,400000000)" >/dev/null 2>&1; done
sleep 2
probe acme-shop echo 10 "$D" >"$OUT/c4e.json" & p1=$!
probe data-co db-query 3 "$D" "$q" >"$OUT/c4d.json" & p2=$!
wait $p1 $p2; v=$(cat "$OUT/c4e.json"); d=$(cat "$OUT/c4d.json"); echo "  C4 echo    : $v"; echo "  C4 db-query: $d"
allok "$v"; check "C4 Postgres saturated: non-DB traffic unaffected (no PG on hot path)" "$v" $?
p99=$(field "$d" p99_ms); bp=$(field "$b4" p99_ms)
python3 -I -c "import sys;sys.exit(0 if float('$p99')<30000 else 1)" 2>/dev/null
check "C4 db-query p99 bounded (<30 s; ${p99}ms vs ${bp}ms before; ok=$(field "$d" ok)/$(field "$d" sent))" "$d" $?
docker exec "$PG" psql -U "$PGU" -d "$PGD" -qAtc "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE query LIKE 'SELECT count(*) FROM generate_series(1,400000000)%' OR query LIKE 'SELECT pg_sleep(%' AND pid<>pg_backend_pid()" >/dev/null 2>&1
sleep 3; v=$(probe data-co db-query 3 5 "$q"); echo "  C4 after storm: $v"
allok "$v"; check "C4 db-query recovers after storm" "$v" $?
summary chaos
