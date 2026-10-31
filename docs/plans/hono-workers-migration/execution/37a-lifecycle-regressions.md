# 37a: Match lifecycle regression fixtures

Issue #414. The lifecycle suite publishes its fixture through the canonical question owner, producing the sealed runner input index. The deadline test uses real match admission, Docker execution, the signed local verifier and fenced promotion. A completed late result cannot overturn the already settled no-contest outcome. A concurrent deadline/forfeit test checks one terminal event, valid winner or deadline draw, and reservation cleanup. Rule-event tests cover HTTP validation, idempotent replay, conflicting replay, suppression, bounded history, outsider and foreign-guest denial.

Validation on disposable loopback PostgreSQL `quorem_hono_lifecycle_test` and local Docker: Node 14/14; native workerd 2/2; API typecheck and scoped lint passed. Database guards require PostgreSQL, loopback and the exact disposable database name; connection parameters cannot override the host. No hosted provider behavior was tested.
