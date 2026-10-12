# 10 — Deployment (AWS, ~$10 of $100 credits)

## Topology
| Box | Type | Role |
|---|---|---|
| EC2 #1 `bulkhead-platform` | c6i.xlarge (4 vCPU, 8 GB), Ubuntu 24.04, 50 GB gp3 | compose stack: caddy, bulkheadd, predictor, postgres, redis, dashboard, tenant workers |
| EC2 #2 `bulkhead-loadgen` | t3.medium | loadgen binary, same VPC/AZ |
Same VPC; SG: 443 + 22 (your IP) on #1, #1:8080 from #2 only.

## Why EC2 not Fargate/EKS
Need privileged Docker control (cgroup `update`, Docker API). Fargate hides cgroups. EKS = time sink; K8s mapping is documented (doc 15).

## Setup steps
1. Launch both, attach Elastic IP to #1, optional DNS name.
2. Install Docker + compose; enable **cgroup v2** (default on Ubuntu 24.04); verify `stat -fc %T /sys/fs/cgroup` = `cgroup2fs`.
3. `docker compose up -d` using `deploy/compose.prod.yml`; secrets via `.env` (JWT secret, admin token, DB password) — never committed.
4. Caddy auto-HTTPS on the domain (or self-signed + IP).
5. Seed script: tenants, API keys, policies.
6. Smoke test script: `deploy/smoke.sh` (auth, invoke, throttle fire, WS stream).

## Measurement hygiene
- Pin platform containers/worker pools CPU sets where possible; leave 1 core for host/Docker/Postgres to avoid measuring our own noise.
- Loadgen on a separate host.
- Disable burstable CPU credits surprises: use c6i (non-burstable) for platform.

## Resilience for demo day
- Local `docker compose up` profile on laptop (same images).
- Pre-recorded 3-min video of A/B run.
- Pre-baked results JSON for the A/B screen if live run fails ("replay results" mode).
- Budget alarm at $25; stop instances after.

## Observability (ours)
Structured JSON logs, `/metrics` Prometheus endpoint (optional), request IDs.

## Domain & HTTPS (udaybhangare.com)
- Use one subdomain: `bulkhead.udaybhangare.com` (dashboard at `/`, API at `/v1`, `/admin`, WS at `/admin/stream`, all behind Caddy). Optional second: `loadgen.udaybhangare.com` is NOT needed (loadgen is a client).
- DNS: add an **A record** `bulkhead` → EC2 #1 Elastic IP at wherever the domain's DNS is managed (registrar or Cloudflare). TTL 300. If using Cloudflare, set the record to "DNS only" (grey cloud) so Caddy can obtain its certificate.
- Caddy needs ports 80 and 443 open in the security group for Let's Encrypt; certificate is automatic after DNS propagates (usually minutes).
- Do not change the apex `udaybhangare.com` or existing records.
- Fallback: access via `https://<elastic-ip>` with Caddy internal CA (browser warning) if DNS isn't ready.

### DNS provider: Spaceship (confirmed)
`udaybhangare.com` is registered/managed at Spaceship (spaceship.com). Steps: Spaceship dashboard → Domain List → `udaybhangare.com` → Manage → DNS records → Add record → Type `A`, Host `bulkhead`, Value = EC2 Elastic IP, TTL 300 (or lowest). Prerequisite: the domain must use Spaceship's default nameservers (check the Nameservers section); if it points elsewhere, add the record at that provider instead. No proxy/CDN layer exists, so Caddy's Let's Encrypt works directly. Verify: `dig +short bulkhead.udaybhangare.com`. UI labels may differ slightly; follow what the dashboard shows.
