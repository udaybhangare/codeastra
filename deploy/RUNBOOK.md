# Deployment runbook (AWS, two EC2 boxes + local fallback)

Design: docs/10. Everything below is manual console + shell; no Terraform.
Terms: **EC2** = a rented virtual machine. **Security group (SG)** = the box's firewall.
**Elastic IP** = a fixed public IP. **Compose** = Docker's "start all containers from one file".

## 0. Local fallback first (laptop, same images) — `make demo-local`
Needs Docker only. Starts the full stack at https://localhost:8443 (accept the browser warning).
```
make demo-local          # builds images, starts stack, seeds, runs smoke
make demo-local-down     # stop (add -v to compose down manually to wipe data)
```

## 1. AWS console (you do this once)
1. **Budget alarm first**: Billing → Budgets → Create budget → Cost budget, monthly **$25**, email alert at 80 % and 100 %.
2. **Key pair**: EC2 → Key pairs → Create (`bulkhead`, ED25519, .pem). Keep the file safe.
3. **Security group `bulkhead-platform`** (default VPC):
   | Type | Port | Source |
   |---|---|---|
   | SSH | 22 | **My IP** |
   | HTTP | 80 | 0.0.0.0/0 (Let's Encrypt) |
   | HTTPS | 443 | 0.0.0.0/0 |
   | Custom TCP | 8080 | SG `bulkhead-loadgen` (add after creating it) |
   Never open 5432 (Postgres), 6379 (Redis) or 2375/2376 (Docker).
4. **Security group `bulkhead-loadgen`**: SSH 22 from My IP only.
5. **Launch EC2 #1** `bulkhead-platform`: Ubuntu 24.04, **c6i.xlarge**, 50 GB gp3, SG `bulkhead-platform`.
   **Launch EC2 #2** `bulkhead-loadgen`: Ubuntu 24.04, t3.medium, **same VPC and AZ**, SG `bulkhead-loadgen`.
6. **Elastic IP**: EC2 → Elastic IPs → Allocate → Associate with #1. Note the IP and #1's *private* IP (10.x.x.x).

## 2. DNS at Spaceship (A record `bulkhead` → Elastic IP)
1. Spaceship → **Domain List** → `udaybhangare.com` → **Manage**.
2. Open **Nameservers**: it must say Spaceship's default (basic) nameservers. If it points elsewhere, add the record at that provider instead.
3. Open **DNS records** → **Add record**: Type `A`, Host `bulkhead`, Value = Elastic IP, TTL 300 (or lowest).
   Do not touch the apex `udaybhangare.com` or any existing record.
4. Verify (from your laptop): `dig +short bulkhead.udaybhangare.com` → prints the Elastic IP. Usually minutes; can take up to an hour.
5. While waiting, use `SITE_ADDRESS=<Elastic IP>` (Caddy self-signed cert → browser warning). Switch later: edit `deploy/.env`, `docker compose -f compose.prod.yml up -d caddy`.

## 3. Box #1 (platform)
```
ssh -i bulkhead.pem ubuntu@<ELASTIC_IP>
git clone <your repo url> bulkhead && cd bulkhead
sudo deploy/bootstrap.sh          # Docker + cgroup v2 check; expect "OK: docker ..., cgroup v2"
newgrp docker                      # pick up docker group
deploy/gen-env.sh bulkhead.udaybhangare.com <BOX1_PRIVATE_IP>
deploy/build.sh                    # ~5-8 min first time
cd deploy && docker compose -f compose.prod.yml up -d
./seed.sh                          # migrations + tenants + keys -> deploy/keys.json
./smoke.sh                         # expect "smoke: 7 passed, 0 failed"
```
`docker compose -f compose.prod.yml ps` shows all services `running`. Open `https://bulkhead.udaybhangare.com`.

## 4. Box #2 (loadgen) — drives S1 across the network
```
ssh -i bulkhead.pem ubuntu@<LOADGEN_IP>
git clone <repo> bulkhead && cd bulkhead
sudo deploy/bootstrap.sh && newgrp docker
deploy/build.sh loadgen
cd deploy
# from your laptop: scp keys.json from box #1, and put these 2 lines in deploy/.env on box #2:
#   LOADGEN_TARGET=http://<BOX1_PRIVATE_IP>:8080
#   ADMIN_API_KEY=<same value as in box #1 deploy/.env>
docker compose -f compose.loadgen.yml run --rm loadgen ab S1 --seed 42 --out /results
```
`ab` runs isolation OFF then ON with the same seed and prints the comparison. Run it 3× and report medians (R2).

## 5. Demo-day resilience (R6)
- Laptop: `make demo-local` (same images).
- Pre-recorded results: `dashboard/public/recorded/S1.json` ("Load recorded" in Scenario Lab).
- Re-record on EC2 for clean numbers (prompt 19) and replace that file.

## 6. Shut down (avoid charges)
- Pause: EC2 → select both → Instance state → **Stop** (Elastic IP bills ~$3.6/mo while the box is stopped; release it if done).
- Done for good: Terminate both, release the Elastic IP, delete the DNS A record `bulkhead`.
- Check Billing dashboard next day.

## Troubleshooting
- `compose up` says variable missing → `deploy/.env` absent; run `gen-env.sh`.
- Caddy cert errors → DNS not propagated, or port 80/443 closed in SG.
- Smoke "tenant token" FAIL → run `./seed.sh`; keys are shown once and live in `deploy/keys.json`.
- Workers not starting → `docker logs bulkheadd`; confirm image `bulkhead/worker:dev` exists (`deploy/build.sh worker`).
