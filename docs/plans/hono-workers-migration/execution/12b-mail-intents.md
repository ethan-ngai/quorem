# 12b: Auth mail intents

Issue #361. Registration challenge, encrypted intent and rate budgets commit together. Each send claims one intent for 30 seconds, releases its database transaction, then delivers and acknowledges with claim/generation/expiry fencing. An expired claim becomes uncertain and is never automatically retried. Explicit resend creates a new generation, invalidates the old registration token and cancels older pending/in-flight intents. A fenced definite rejection refunds only the original, still-current budget windows and restores the prior registration proof if the rejected token still owns it; explicit immediate retry is then possible. Uncertain delivery retains budgets and proof. Account budgets remain shared across subjects and the global bucket remains shared across recipients. Account lanes separate distinct subjects.

AES-256-GCM uses a caller-injected 32-byte key, random nonce and associated intent ID, purpose and generation. Intent payload contains the destination and link only in ciphertext. SMTP negative replies produce `MailRejected`; other exceptions remain uncertain. Better Auth creates its own token before calling the account gateway: an intent failure prevents delivery but cannot roll back that token. The undisclosed orphan expires under Better Auth's policy.

Composition contract: create `createMailRepository(runTransaction)` with a fresh bounded scope per call; inject that repository, key and the existing transport `VerificationSender` into `createMailIntentService`. Pass the service to `accountMailer`, `accountVerificationSender` for social proof mail, and `createRegistrationHandler({ repository, mail, origin })`. The transport passed to the service must not be the service-backed sender. Provision and rotate the encryption key through runtime composition; never log it or decrypted payloads.

## Local verification

Use only disposable loopback PostgreSQL. The mail integration test drops `quorem_auth` in its named database. From the repository root:

```sh
export SPIKE_PASSWORD="$(openssl rand -hex 16)"
docker run -d --name quorem-hono-mail-12b -e POSTGRES_PASSWORD="$SPIKE_PASSWORD" -e POSTGRES_DB=quorem_hono_mail_test -p 127.0.0.1:55440:5432 postgres:17
docker exec quorem-hono-mail-12b createdb -U postgres quorem_hono_schema_test
QUOREM_MAIL_TEST_DATABASE_URL="postgresql://postgres:$SPIKE_PASSWORD@127.0.0.1:55440/quorem_hono_mail_test" vp exec node --test apps/auth/src/mail-intents.test.ts
AUTH_TEST_DATABASE_URL="postgresql://postgres:$SPIKE_PASSWORD@127.0.0.1:55440/quorem_hono_mail_test" vp -C apps/auth exec vitest run src/migrations.test.ts src/registration.test.ts
QUOREM_SCHEMA_TEST_DATABASE_URL="postgresql://postgres:$SPIKE_PASSWORD@127.0.0.1:55440/quorem_hono_schema_test" vp -C packages/database run test
vp -C apps/auth exec vitest run src/adapters/email.test.ts
vp -C packages/database run typecheck
docker rm -f quorem-hono-mail-12b
```

Passed: 22 PostgreSQL mail tests, auth migration history and existing registration tests, schema/catalog parity, provider outcome tests and database typecheck. Tests cover atomic failure, takeover guards, grant consumption, shared budgets, ciphertext binding, no transaction held during delivery, claim crash, expiry/supersession, lost acknowledgment, uncertain and rejected delivery, immediate retry, concurrent senders, prior proof restoration, bucket rollover, duplicate dispatch and corrupt ciphertext. Intent claims, acknowledgments, budget refunds, registration proofs and grants recheck wall-clock expiry after acquiring row locks. Uncertain registration delivery returns 503 while retaining proof and budgets. No actual mail was sent.

Node and Worker composition use these APIs; full auth typecheck, lint and runtime fixture tests pass. See [auth composition](11-auth-factory.md). Hosted Worker/provider delivery, key rotation and expired-intent retention remain unverified. No automatic retry follows uncertain acceptance; explicit resend is required. Expired ciphertext requires an independently scheduled retention mechanism before production activation.
