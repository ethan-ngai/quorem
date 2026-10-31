import { test } from "node:test";
import assert from "node:assert/strict";
import { checkWorkerEntrypoint } from "./hono-stage-gate.mjs";
const exports =
  "export const BrowserSockets=1; export class DeadlineCoordinator {} export class ExecutionRecovery {}";
test("requires the real queue handler and all Durable Object exports", () => {
  assert.throws(
    () => checkWorkerEntrypoint(`${exports} export default {fetch(){},scheduled(){}}`),
    /queue handler missing/,
  );
  assert.throws(
    () => checkWorkerEntrypoint("export default {fetch(){},scheduled(){},queue(){}}"),
    /BrowserSockets export missing/,
  );
  assert.doesNotThrow(() =>
    checkWorkerEntrypoint(`${exports} export default {fetch(){},scheduled(){},queue(){}}`),
  );
});
