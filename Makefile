.PHONY: install dev database seed provision access profile-reads backfill-results validate-leetcode-structure reset api runner verifier web language auth check build

QUOREM_ENV ?= development
APP_ENV ?= local
QUOREM_DEV_IDENTITY ?= false
DATABASE_URL ?= postgres://quorem:quorem@localhost:54329/quorem_hono_dev?sslmode=disable
export QUOREM_ENV APP_ENV QUOREM_DEV_IDENTITY DATABASE_URL

install:
	vp install --frozen-lockfile

database:
	docker compose up -d --wait

seed: database
	node --experimental-strip-types apps/api/src/cli/seed-local.ts

provision:
	node --experimental-strip-types apps/api/src/cli/provision.ts $(ARGS)

access:
	node --experimental-strip-types apps/api/src/cli/access.ts $(ARGS)

profile-reads:
	node --experimental-strip-types apps/api/src/cli/profile-reads.ts

backfill-results:
	node --experimental-strip-types apps/api/src/cli/backfill-results.ts $(ARGS)

validate-leetcode-structure:
	python3 scripts/validate-leetcode-structure.py $(ARGS)

reset:
	@test "$${QUOREM_ENV}" = development && test "$${APP_ENV}" = local && test "$${DATABASE_URL}" = "postgres://quorem:quorem@localhost:54329/quorem_hono_dev?sslmode=disable" || { echo "reset requires the local development database"; exit 1; }
	docker compose exec -T postgres psql -U quorem -d postgres -c 'DROP DATABASE IF EXISTS quorem_hono_dev WITH (FORCE)'
	$(MAKE) seed

dev:
	python3 scripts/dev.py

api:
	vp -C apps/api run start

runner:
	vp -C apps/runner run runner

verifier:
	vp -C apps/runner run verifier

web:
	vp -C apps/web dev --host 127.0.0.1 --port 5173 --strictPort

auth: api

language:
	vp -C apps/language run dev

check:
	vp check
	vp run contracts:check
	vp -C apps/auth test
	vp -C apps/web test
	vp run --filter @quorem/language test
	vp -C apps/api run typecheck
	vp -C apps/api test
	vp -C apps/runner run typecheck

build:
	vp run build
	vp -C apps/api run typecheck
	vp -C apps/runner run typecheck
	vp -C apps/language run check
