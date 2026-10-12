COMPOSE = docker compose -f deploy/compose.dev.yml --env-file .env.example

.PHONY: demo demo-dry-run demo-recorded verify-security verify-integration verify-chaos verify-repeat verify-all demo-local demo-local-down worker-image dev down migrate seed mock test test-go test-py test-dash lint

worker-image: ## build tenant worker image bulkhead/worker:dev
	cd worker && CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags='-s -w' -o worker-linux . && docker build -q -t bulkhead/worker:dev .

dev: ## start postgres + redis
	$(COMPOSE) up -d --wait postgres redis

down:
	$(COMPOSE) down

migrate: ## apply DB migrations (idempotent; needs `make dev`)
	cd platform && go run ./cmd/migrate

seed: ## seed tenants/keys/policies/demo.events (idempotent)
	cd platform && go run ./cmd/seed

mock: ## mock WS stream on ws://localhost:8081/admin/stream
	cd platform && go run ./cmd/mockstream

test: test-go test-py ## all unit tests

test-go:
	cd platform && go test ./...
	cd worker && go test ./...
	cd loadgen && go test ./...

test-py: ## contract validation + predictor tests
	cd predictor && uv run pytest -q

lint:
	cd platform && go vet ./...
	cd worker && go vet ./...
	cd loadgen && go vet ./...
	cd dashboard && npm run -s lint

demo-local: ## full prod-like stack on this machine: https://localhost:8443
	[ -f deploy/.env ] || deploy/gen-env.sh localhost
	deploy/build.sh
	cd deploy && docker compose -f compose.prod.yml up -d --wait postgres redis
	cd deploy && docker compose -f compose.prod.yml up -d
	cd deploy && ./seed.sh && sleep 3 && ./smoke.sh

demo-local-down:
	cd deploy && docker compose -f compose.prod.yml down

# --- prompt 19: verification against the running stack (make demo-local first) ---
verify-security: ## cross-tenant / token tampering / admin role checks (~10 s)
	deploy/verify/security.sh

verify-integration: ## S1,S2,S3,S6 ON-mode assertions (~8 min)
	deploy/verify/integration.sh 1

verify-chaos: ## kill worker, stop Redis/predictor, saturate Postgres (~2 min)
	deploy/verify/chaos.sh

verify-repeat: ## S1 A/B x5, median + spread (~20 min)
	deploy/verify/repeat.sh S1 5 1

verify-all: ## unit + all of the above (~35 min)
	deploy/verify/run-all.sh

# --- prompt 20: demo ---
demo: ## warm everything for the live demo (starts the stack if needed)
	demo/warmup.sh

demo-dry-run: ## timed headless rehearsal: S1 A/B + S6 + S2, N=1 (make demo-dry-run N=3)
	demo/dry-run.sh $(or $(N),1)

demo-recorded: ## offline fallback: print recorded A/B tables and sync them to the dashboard
	python3 -I demo/recorded/load.py
	python3 -I demo/recorded/load.py --sync
