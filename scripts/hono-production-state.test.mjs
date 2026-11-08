/** Validate active deployment identity without contacting providers. */
import assert from "node:assert/strict";
import test from "node:test";
import { parseActiveProduction } from "./hono-production-state.mjs";

const outputs = (DATABASE_URL, phase = "active") => ({
  activation: { value: { phase } },
  secrets: { value: { DATABASE_URL } },
});

void test("only the active native production database is selected", () => {
  const connection = "postgresql://operator:fixture@db.neon.tech/neondb";
  assert.equal(parseActiveProduction(outputs(connection)).database.href, connection);
  assert.throws(() => parseActiveProduction(outputs(connection, "prepared")), /is not active/);
  for (const invalid of [
    "postgres://operator:fixture@db.neon.tech/quorem_hono_stage",
    "https://db.neon.tech/neondb",
    "postgres://db.neon.tech.example.test/neondb",
    "invalid-fixture-secret",
  ])
    assert.throws(() => parseActiveProduction(outputs(invalid)), {
      message: "Unexpected production database",
    });
});
