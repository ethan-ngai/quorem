import assert from "node:assert/strict";
import { test } from "node:test";
import { assertBrowserDatabase, startBrowserFixture } from "./browser-fixture.ts";

void test("browser fixture requires its exact disposable loopback database and port", async () => {
  assert.doesNotThrow(() =>
    assertBrowserDatabase(
      "postgres://fixture@127.0.0.1:55701/quorem_hono_runtime_test?sslmode=disable",
    ),
  );
  for (const value of [
    "postgres://fixture@127.0.0.1:54329/quorem_hono_runtime_test",
    "postgres://fixture@127.0.0.1:55690/quorem_hono_runtime_test",
    "postgres://fixture@127.0.0.1:55701/quorem",
    "postgres://fixture@localhost:55701/quorem_hono_runtime_test",
    "postgres://fixture@127.0.0.1:55701/quorem_hono_runtime_test?host=elsewhere",
    "postgres://fixture@127.0.0.1:55701/quorem_hono_runtime_test?HOSTADDR=10.0.0.1",
    "postgres://fixture@127.0.0.1:55701/quorem_hono_runtime_test#fragment",
  ])
    assert.throws(() => assertBrowserDatabase(value));
  await assert.rejects(
    startBrowserFixture(
      "postgres://fixture@127.0.0.1:54329/quorem_hono_runtime_test",
      "/var/run/docker.sock",
    ),
  );
});
