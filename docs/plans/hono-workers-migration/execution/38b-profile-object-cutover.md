# 38b: profile object cutover

Issue #436. The operator reads the existing `quorem_auth.user.image` references in bounded user-ID order, using the same key rules as profile reads. It never lists buckets or changes user pointers. Each reference reads the source, compares SHA-256 with the destination, conditionally creates a missing destination object, and rereads it. A missing source or differing destination fails closed. Source objects are never deleted. Writes use S3 `If-None-Match: *`, which [AWS S3](https://docs.aws.amazon.com/AmazonS3/latest/userguide/conditional-writes.html) and [Cloudflare R2](https://developers.cloudflare.com/r2/api/s3/extensions/) document as atomic; unsupported S3-compatible endpoints are not established by this validation.

Configure `QUOREM_OPERATOR_DATABASE_URL`, `AUTH_ORIGIN`, and `PROFILE_COPY_SOURCE_BUCKET`, `PROFILE_COPY_SOURCE_ENDPOINT`, `PROFILE_COPY_DESTINATION_BUCKET`, `PROFILE_COPY_DESTINATION_ENDPOINT`. Optional `PROFILE_COPY_{SOURCE,DESTINATION}_REGION`, and paired `PROFILE_COPY_{SOURCE,DESTINATION}_ACCESS_KEY_ID` and `_SECRET_ACCESS_KEY` select credentials; otherwise the AWS provider chain is used. Endpoints require HTTPS except local loopback. Both endpoints must identify distinct buckets. Use secret injection, not command-line credentials.

```
node --experimental-strip-types apps/api/src/cli/profile-object-cutover.ts \
  --reason 'operator reason' --resume-file /secure/path/audit.json --limit 16 --max-batches 100
```

Audit is the default. Add `--apply` and use a separate resume file to copy missing objects. Each bounded batch verifies the existing bootstrap operator and records a credential-free audit event. The mode-0600 resume file holds the private cursor and configuration fingerprint; reuse it after interruption. `complete` means only that this scan reached its end. `cutoverReady` is always false: no authoritative old-writer quiescence/frozen-reference mechanism is implemented, and an active writer can create an earlier reference after the cursor passed. A fresh audited scan after independently proving old writers stopped is required, followed by a separately authorized cutover procedure. The real source bucket and hosted object state remain unknown; no cloud requests or production writes were performed.

Local verification used PostgreSQL 127.0.0.1:55707 `quorem_hono_profile_cutover_test` and a local S3 protocol fixture: audit/no-write, disabled operator denial, bounded resume, destination mismatch, conditional-create race and post-write reread passed. `node --experimental-strip-types --test apps/auth/src/profile-object-cutover.test.ts` passed 5 tests. Both auth and API typechecks passed. Existing profile/S3 tests passed 17 with one real-session test skipped without its database fixture.
