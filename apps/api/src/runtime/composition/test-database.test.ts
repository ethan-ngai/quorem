import { expect, it } from "vitest";
import { assertRuntimeTestDatabase } from "./test-database.ts";

it("requires a disposable loopback database without connection overrides", () => {
  expect(() =>
    assertRuntimeTestDatabase(
      "postgres://user@127.0.0.1:55599/quorem_hono_runtime_test?sslmode=disable",
    ),
  ).not.toThrow();
  for (const url of [
    "https://127.0.0.1/quorem_hono_runtime_test",
    "postgres://localhost/quorem_hono_runtime_test",
    "postgres://127.0.0.1/other",
    "postgres://127.0.0.1/quorem_hono_runtime_test?host=remote",
    "postgres://127.0.0.1/quorem_hono_runtime_test?hostaddr=10.0.0.1",
    "postgres://127.0.0.1/quorem_hono_runtime_test?service=production",
  ])
    expect(() => assertRuntimeTestDatabase(url)).toThrow();
});
