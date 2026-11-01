/// <reference types="node" />
import assert from "node:assert/strict";
import { test } from "node:test";
import { createRunner } from "./runner.ts";
void test("runner composition fails closed without a selected manifest engine", () => {
  assert.throws(
    () =>
      createRunner({
        sandbox: {
          scope: "scope",
          runCase: async () => {
            throw new Error();
          },
          teardownAttempt: async () => {},
        },
        commandOrigin: "https://private.invalid",
        commandSecret: "x".repeat(32),
        drainSecret: "y".repeat(32),
        slots: 1,
        resumable: true,
        commandTimeoutMs: 1000,
        engine: undefined as never,
      }),
    /Manifest-capable engine required/,
  );
});
void test("runner rejects an explicitly supplied legacy engine", () => {
  assert.throws(
    () =>
      createRunner({
        sandbox: {
          scope: "scope",
          runCase: async () => {
            throw new Error();
          },
          teardownAttempt: async () => {},
        },
        commandOrigin: "https://private.invalid",
        commandSecret: "x".repeat(32),
        drainSecret: "y".repeat(32),
        slots: 1,
        resumable: true,
        commandTimeoutMs: 1000,
        engine: (() => ({ execute: async () => "complete" })) as never,
      }),
    /Manifest-capable engine required/,
  );
});
