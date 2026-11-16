# Trusted TypeScript judge

`make dev` configures and starts the runner and independent verifier beside the native Hono API. For separately configured processes, use `vp -C apps/runner run runner` and `vp -C apps/runner run verifier`. Configuration is owned by [runtime/config.ts](src/runtime/config.ts).

The runner claims authoritative leases through authenticated internal API commands, executes through the sandbox port, and submits independently verified results. It does not mutate product PostgreSQL tables directly. Attempt IDs fence heartbeats, cancellation, checkpoints and completion. Unconfirmed teardown prevents reuse of the attempt.

The Docker adapter supports local isolated Python, Java, TypeScript, OCaml and PostgreSQL cases. The remote adapter targets the separately provisioned case service with namespace/scope pins and signed teardown. Trusted runner/verifier credentials never enter untrusted case containers. Harness assets remain in their language directories.

Build fixture images and run real local execution checks:

```sh
python3 scripts/build-judge-images.py --base-only
node scripts/hono-container-validation.mjs
node scripts/hono-sql-validation.mjs
node scripts/hono-workload-validation.mjs
```

These owners create separate disposable PostgreSQL fixtures and require actual Docker execution. Hosted isolation and workload evidence comes from the native staged deployment workflow; local success does not establish cloud performance.

Canonical contracts and runtime behavior live in `packages/execution`, `src/orchestration`, `src/sandbox` and `src/runtime`. Retained checkpoint/result compatibility and operator backfills are documented in [database operations](../../docs/implementation/database.md).

## Case timing and acceptance

The Linux supervisor accounts for case cgroup CPU from harness readiness. Compiled
harnesses report a separate compilation measurement. A longer in-sandbox watchdog
bounds blocked programs. Transport deadlines trigger fenced recovery. Only a trusted
terminal response can turn a supervisor deadline into a contestant time-limit verdict.

Full-constraint matches use the complete hidden suite and the published per-case CPU
budget. Small-input matches reuse the published small-profile prefix and admit twice the
published CPU budget, capped at 10 seconds. Questions without that profile use the full
suite and published budget. Review submissions reuse the original match setting.
The database migration adds a nullable override to execution jobs. Existing question
publications need no rewrite.

When authoring a tier, put correctness and smaller inputs in its prefix and use the
largest valid adversarial inputs to separate growth rates in the full suite. Verify
multiple intended implementations, including ones with higher constants, against a
representative slower implementation. Keep generous headroom and improve inputs
when those runtimes overlap.
