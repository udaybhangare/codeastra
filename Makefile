COMPOSE = docker compose -f deploy/compose.dev.yml --env-file .env.example

.PHONY: worker-image dev down migrate seed mock test test-go test-py test-dash lint

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
