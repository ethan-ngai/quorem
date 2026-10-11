.PHONY: install dev database seed reset api runner web language check build

QUOREM_ENV ?= development
APP_ENV ?= local
QUOREM_DEV_IDENTITY ?= true
DATABASE_URL ?= postgres://quorem:quorem@localhost:54329/quorem?sslmode=disable
export QUOREM_ENV APP_ENV QUOREM_DEV_IDENTITY DATABASE_URL

install:
	vp install --frozen-lockfile

database:
	docker compose up -d --wait

seed: database
	go run ./apps/api/cmd/api -seed

reset:
	@test "$${QUOREM_ENV}" = development && test "$${APP_ENV}" = local && test "$${DATABASE_URL}" = "postgres://quorem:quorem@localhost:54329/quorem?sslmode=disable" || { echo "reset requires the local development database"; exit 1; }
	docker compose down --volumes
	$(MAKE) seed

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
	vp -C apps/web test
	vp run --filter @quorem/language test
	go test ./...
	go vet ./...

build:
	vp -C apps/web build
	go build ./apps/api/cmd/api ./apps/runner/cmd/runner
