# Result-stream implementation — #560

Owner: `apps/api/src/adapters/postgres/judging/results`. Review finding: backend #3.

Removed repeated scanning from array start for each fallback example and hidden status. One forward reader per array retains bounded source chunks; skipped values never aggregate. Every selected ordinal rechecks account, membership, role/epoch, retained header, and captured source-row version before exposing buffered bytes. Both readers close on completion/cancellation. Private metadata uses the existing per-entry authorization rather than retaining a stale visibility plan; common checks now reuse `authorizePage`.

Interview public-case reads retain per-case authorization. An attempted batch was rejected during cross-review because cached cases could be emitted after revocation. No batch/membership cache is retained. Broader private-result windowing remains a measured follow-up, not a claim of reduced transaction count.

Validation: four focused primitive tests; 27 Node PostgreSQL result/cancellation tests; six workerd PostgreSQL tests, including over-128-MiB public and 16-MiB private streams. All passed against a uniquely named disposable PostgreSQL container, subsequently removed. New regressions cover sparse/lossless/split arrays, early close, per-ordinal authorization, two examples within one byte page followed by membership revocation, source-row xmin change, and retention. Existing tests cover hidden data, role/epoch, guest revocation, cancellation, lossless/NUL output and large header fields. The new result primitives, authoring queries and grant authorization suites are wired into CI with a separate disposable authoring database. PR validation also covers feature bases so stacked PRs receive the same checks as dev-targeting PRs. No hosted performance or isolation claim.

Terra cross-review caught stale cached authorization and row-version checks in the initial implementation; those were fixed and re-reviewed without further blockers. Final integration/CI status belongs in README.md.
