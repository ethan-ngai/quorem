.PHONY: install dev database api runner web language check build

install:
	vp install --frozen-lockfile

database:
	docker compose up -d --wait

dev:
	python3 scripts/dev.py

api:
	go run ./apps/api/cmd/api

runner:
	go run ./apps/runner/cmd/runner

web:
	vp -C apps/web dev --host 127.0.0.1 --port 5173 --strictPort

language:
	vp run --filter @quorem/language dev

check:
	vp check
	vp run contracts:check
	go test ./...
	go vet ./...

build:
	vp -C apps/web build
	go build ./apps/api/cmd/api ./apps/runner/cmd/runner
