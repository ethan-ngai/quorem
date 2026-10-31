# Reclaim contract prerequisite

Parent #335. Adopted the frozen exact-attempt/sandbox-scope contract from PR #322 head `27b09e27ea034dc5853ab5edb2a5e80c3197bbf5` onto the migration branch; the original PR, its branch, dev and main remain untouched. This establishes the regression oracle and product migration 048 before dispatch adds later migrations. It does not implement the TypeScript judge.

An expired attempt can be reclaimed only after teardown confirms its exact attempt and recorded sandbox scope. Claim rechecks the pair under the job lock, closing the scan/claim expiry race. Unsupported runtime/lossless work cannot select an attempt for teardown. The SQL trigger rejects stale writers attempting replacement/finalization without the expected teardown marker. The Drizzle schema includes the nullable sandbox scope column; migration history remains the existing product ledger.

On disposable loopback PostgreSQL 17 at port 55456, `go test ./apps/api/internal/adapters/postgres -run 'Test(Reclaim|Expired)'` and `go test ./apps/api/worker -run 'Test(LeaseExpiry|ContinuousRunnerReaps|PostgresDrain)'` passed with `QUOREM_TEST_DATABASE_URL` targeting `quorem_hono_reclaim_test`. The database package's migration/catalog/restore parity test also passed against separately named `quorem_hono_schema_test`. No development database was touched.

Packet 27 must port this contract, not just copy the attempt UUID. Old attempts lacking a recorded scope need verified teardown/drain before activation; do not infer a scope or clear them to make progress. Hosted sandbox isolation/teardown and migration cutover remain separate gates.
