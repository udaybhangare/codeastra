#!/usr/bin/env bash
# Security assertions against the live API: cross-tenant, token tampering, admin role.
source "$(dirname "$0")/lib.sh"
echo "== security ($BASE)"
A=$(tenant_token acme-shop); R=$(tenant_token rogue-ml); AD=$(admin_token)
[ -n "$A" ] && [ -n "$R" ] && [ -n "$AD" ] || { echo "cannot mint tokens (stack up? seeded?)"; exit 2; }
H() { echo "Authorization: Bearer $1"; }
# 1 tenant JWT must not reach admin API
for p in /admin/tenants /admin/usage /admin/events /admin/predictor; do
  c=$(code "$BASE$p" -H "$(H "$A")"); [ "$c" = 401 ] || [ "$c" = 403 ]; check "tenant JWT denied on $p" "HTTP $c" $?
done
c=$(code -X POST "$BASE/admin/isolation" -H "$(H "$A")" -d '{"mode":"off"}'); [ "$c" = 401 ] || [ "$c" = 403 ]; check "tenant JWT cannot flip isolation" "HTTP $c" $?
c=$(code -X POST "$BASE/admin/tenants/acme-shop/revoke-tokens" -H "$(H "$R")"); [ "$c" = 401 ] || [ "$c" = 403 ]; check "tenant JWT cannot revoke another tenant" "HTTP $c" $?
# 2 admin API key is not a bearer token / no creds
c=$(code "$BASE/admin/tenants"); [ "$c" = 401 ]; check "admin API without creds -> 401" "HTTP $c" $?
c=$(code "$BASE/admin/tenants" -H "X-Admin-Key: $ADMIN_KEY"); [ "$c" = 401 ] || [ "$c" = 403 ]; check "raw admin key is not accepted as credential on data routes" "HTTP $c" $?
c=$(code -X POST "$BASE/admin/auth/token" -H "X-Admin-Key: wrong"); [ "$c" = 401 ] || [ "$c" = 403 ]; check "wrong admin key rejected" "HTTP $c" $?
c=$(code "$BASE/admin/tenants" -H "$(H "$AD")"); [ "$c" = 200 ]; check "valid admin JWT works (control)" "HTTP $c" $?
c=$(code -X POST "$BASE/v1/invoke/echo" -H "$(H "$AD")" -d '{}'); [ "$c" = 401 ] || [ "$c" = 403 ]; check "admin JWT is not a tenant identity on /v1/invoke" "HTTP $c" $?
# 3 token tampering
tamper() { python3 -I - "$1" "$2" <<'P'
import sys,base64,json
h,p,s=sys.argv[1].split('.'); mode=sys.argv[2]
d=lambda x: json.loads(base64.urlsafe_b64decode(x+'='*(-len(x)%4)))
e=lambda o: base64.urlsafe_b64encode(json.dumps(o,separators=(',',':')).encode()).rstrip(b'=').decode()
pl=d(p)
if mode=='tenant': pl['tenant_id']=pl.get('tenant_id') and 'acme-shop'; pl['tenant']='acme-shop'; pl['sub']='acme-shop'
if mode=='role': pl['role']='admin'
if mode=='alg': print(e({'alg':'none','typ':'JWT'})+'.'+e(pl)+'.'); sys.exit()
print(h+'.'+e(pl)+'.'+s)
P
}
for m in tenant role alg; do
  T=$(tamper "$R" $m); c=$(code -X POST "$BASE/v1/invoke/echo" -H "$(H "$T")" -d '{}'); [ "$c" = 401 ]; check "tampered JWT ($m) rejected on invoke" "HTTP $c" $?
done
T=$(tamper "$R" role); c=$(code "$BASE/admin/tenants" -H "$(H "$T")"); [ "$c" = 401 ] || [ "$c" = 403 ]; check "role-escalated JWT rejected on admin" "HTTP $c" $?
c=$(code -X POST "$BASE/v1/invoke/echo" -H "Authorization: Bearer ${R%.*}.AAAA" -d '{}'); [ "$c" = 401 ]; check "forged signature rejected" "HTTP $c" $?
c=$(code -X POST "$BASE/v1/invoke/echo" -d '{}'); [ "$c" = 401 ]; check "no token -> 401" "HTTP $c" $?
# 4 tenant identity only from claims
body=$(curl -sS "$BASE/v1/me/usage" -H "$(H "$R")" -H "X-Tenant-ID: acme-shop" -H "X-Tenant: acme-shop")
echo "$body" | grep -q 'acme-shop'; [ $? -ne 0 ]; check "X-Tenant-ID header cannot switch identity (/v1/me/usage)" "response mentions acme-shop" $?
c=$(code "$BASE/v1/me/usage?tenant_id=acme-shop" -H "$(H "$R")"); body=$(curl -sS "$BASE/v1/me/usage?tenant_id=acme-shop" -H "$(H "$R")")
echo "$body" | grep -q 'acme-shop'; [ $? -ne 0 ]; check "?tenant_id= query cannot read another tenant" "leak in body" $?
# 5 revocation
c=$(code -X POST "$BASE/admin/tenants/leaky-app/revoke-tokens" -H "$(H "$AD")"); [ "$c" = 200 ] || [ "$c" = 204 ]; check "admin revoke-tokens works" "HTTP $c" $?
sleep 1.1 # revocation cut-off has 1 s granularity (iat <= cut); see docs/RESULTS.md
L=$(tenant_token leaky-app); c=$(code -X POST "$BASE/v1/invoke/echo" -H "$(H "$L")" -d '{}'); [ "$c" = 200 ]; check "token minted >1 s after revoke works" "HTTP $c" $?
summary security
