# 37f: Admission fixture

Issue #421. The workerd admission fixture now indexes and seals its version through the same `indexRunnerFixture` owner as publication. The resulting admission still uses the actual manifest-only path and prearmed Durable Object recovery. The fixture URL guard rejects fragments and case-insensitive PostgreSQL host, hostaddr and service overrides, while accepting named loopback databases on any port.

On a fresh disposable PostgreSQL 17 database named `quorem_hono_admission_test`, the CI Node admission/recovery config passed 20 tests (four Go-judge tests skipped because the separately provisioned Go judge was not running); native workerd passed both tests with no skips. Run the CI commands with `QUOREM_ADMISSION_TEST_DATABASE_URL` set to that disposable database. The Go differential fixture remains available under `QUOREM_ADMISSION_GO_JUDGE=true` with its separate judge setup described in [18](18-admission.md).

The other CI worker/integration fixtures with direct version inserts were inspected: catalog and invitation fixtures do not invoke manifest admission, the engine fixture calls `sealFixture`, and match reconciliation tests exercise their own state setup. No other failing admission owner was identified in this audit. Hosted validation remains separate.
