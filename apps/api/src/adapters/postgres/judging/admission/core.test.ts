import { expect, it } from "vitest";
import type { Transaction } from "@quorem/database/core";
import { insertAdmittedExecution } from "./core.ts";
it("rejects an unsupported runtime before touching the transaction", async () => {
  const tx = {} as Transaction;
  await expect(
    insertAdmittedExecution(tx, {
      ownerId: "fixture",
      jobId: crypto.randomUUID(),
      kind: "run",
      source: "x",
      sourceHash: "fixture",
      customRun: false,
      language: "python",
      runtimeRevision: "unavailable",
      harnessRevision: "unavailable",
      sponsorId: null,
      context: {
        kind: "workspace",
        workspaceId: crypto.randomUUID(),
        matchId: null,
        matchSequence: null,
        admittedAt: null,
        odysseyLevel: null,
      },
    }),
  ).rejects.toMatchObject({ code: "temporarily_unavailable" });
});
