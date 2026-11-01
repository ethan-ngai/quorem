# 38g: Existing-stage maintenance

Issue [#432](https://github.com/ethan-ngai/quorem/issues/432). `scripts/hono-stage-maintenance-run.mjs` is the operator entrypoint for an existing, namespace-pinned stage. Provision/deploy remains through Actions; this command does not authorize production or reset storage.

Use the deployed stage's complete configuration, immutable image digests and operator database credential. Set `HONO_STAGE_ACTION=maintenance`; keep the current exact migration workflow revision in `GITHUB_SHA`/`HONO_RELEASE_SHA`, and the deployed runtime role and namespace in their Terraform variables. The plan contains only public authority metadata:

```json
{
  "operation": "<uuid-v4>",
  "runnerOperation": "<uuid-v4>",
  "caseOperation": "<uuid-v4>",
  "namespace": "<64-hex-pinned-namespace>",
  "scope": "remote:<64-hex-canonical-scope>",
  "role": "<deployed-generation-runtime-role>",
  "prior": {
    "generation": 1,
    "release": "<deployed-40-hex-release>",
    "bindings": "<deployed-64-hex-service-bindings>",
    "initialOperation": "<persisted-genesis-uuid-v4>",
    "initialRelease": "<initial-40-hex-release>"
  }
}
```

Obtain `prior` from verified signed control observations and the deployment receipt. Persist three distinct operation UUIDs before invoking:

```sh
vp exec node scripts/hono-stage-maintenance-run.mjs /private/plan.json /private/maintenance-operation
```

The journal directory must be mode 0700. Its immutable `plan.json` and append-only `events.ndjson` are mode 0600; preserve both after process loss. Retry the same plan and directory. The command rechecks every phase rather than trusting a previously recorded acknowledgement. It holds the canonical PostgreSQL recovery advisory lock across remote operations, without a database transaction across HTTP.

Containment independently attempts queue detachment, pinned runner/case pause and committed runtime NOLOGIN/session fencing. Any unconfirmed step prevents teardown/completion. With writers frozen, bounded keyset reads reconcile PostgreSQL's immutable attempt inventory with signed CaseControl pages. Current attempts missing authority, other scopes, peers, prepared transactions, nonadvancing cursors and changed pins fail closed. The canonical remote sandbox adapter verifies full-attempt signed DELETE for each distinct captured attempt. The final controls/writer checks run again before completion.

This proves containment and teardown of captured attempts only. The receipt explicitly reports `historyCoverage: unverified`, `resumeReady: false`, `cutoverReady: false`; neither empty inventories nor the migration ledger establishes complete older history. [Fresh-stage genesis](38h-stage-genesis.md) persists initial authority before activation, but maintenance does not yet consume it or verify contiguous authorized generation history. A reviewed resume workflow, fresh runtime generation credentials, hosted acceptance and queue reattachment remain required. The control client supports replayable explicit generation transitions, but maintenance never calls them.

Local tests cover signed generation transitions/replay, partial containment, bounded real PostgreSQL inventory/fencing, journal persistence, changed-plan rejection and uncertain teardown. Hosted maintenance/restart rehearsal remains unverified until staging activation succeeds.
