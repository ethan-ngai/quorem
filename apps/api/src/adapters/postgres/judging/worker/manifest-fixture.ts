/** @file manifest-fixture.ts @description Local signed verifier and sealed runner fixtures. @module judging */
import { createServer } from "node:http";
import { once } from "node:events";
import type { ConnectionScope } from "@quorem/database/core";
import { sql } from "drizzle-orm";
import { indexRunnerFixture } from "../inputs/fixture.ts";
import { bindJobInputs } from "../inputs/bind.ts";
import { postgresInputReader } from "../inputs/read.ts";
import { postgresVerificationSource } from "./verification-source.ts";
import { httpResultVerifier } from "./verification-client.ts";
import { nodeResultVerifier } from "../../../../../../runner/src/verification/verifier.ts";
import { verificationHandler } from "../../../../../../runner/src/verification/http.ts";
type Run = <T>(f: (scope: ConnectionScope) => Promise<T>) => Promise<T>;
export async function sealFixture(
  run: Run,
  version: string,
  jobId: string,
  cases: { args: unknown[]; expected: unknown }[],
) {
  await run((scope) =>
    scope.transaction({ statementTimeoutMs: 5000, lockTimeoutMs: 1000 }, async (tx) => {
      const existing = await tx.execute(
        sql`SELECT 1 FROM runner_version_inputs WHERE version_id=${version}::uuid AND sealed`,
      );
      if (!existing.rows.length)
        await indexRunnerFixture(
          tx,
          { version },
          JSON.stringify({
            problem: {
              signature: {
                className: "Solution",
                methodName: "f",
                parameters: [],
                returnType: "int",
              },
              constraints: [],
              limits: {
                wallTimeMs: 2000,
                memoryBytes: 268435456,
                outputBytes: 65536,
                maxProcesses: 16,
                maxCollectionElements: 10000,
                maxNestingDepth: 100,
              },
              examples: cases,
            },
            hiddenCases: [],
          }),
        );
      await bindJobInputs(tx, {
        jobId,
        owner: { version },
        level: 0,
        primary: "example",
        custom: [],
        caseCount: cases.length,
        sampleCount: 0,
        privateDetails: false,
        submitCasesAreSamples: false,
      });
    }),
  );
}
export async function localVerifier(run: Run) {
  const source = postgresVerificationSource(run),
    inputs = postgresInputReader(run);
  const keys = await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
  const verify = nodeResultVerifier(
    {
      inputs,
      frozenCase: (id) => source.frozenCase(id),
      fieldPage: (id, field, offset) => source.fieldPage(id, field, offset),
      async putField(id, field, chunks) {
        let n = 0;
        for await (const chunk of chunks) await source.putChunk(id, field, n++, chunk);
      },
    },
    keys.privateKey,
  );
  const credential = new Uint8Array(32).fill(7);
  const server = createServer(verificationHandler({ credential, timeoutMs: 5000, verify }));
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing verifier listener");
  return {
    verification: {
      verifier: httpResultVerifier({
        origin: `http://127.0.0.1:${address.port}`,
        credential,
        timeoutMs: 5000,
      }),
      verificationPublicKey: keys.publicKey,
    },
    async close() {
      server.close();
      await once(server, "close");
    },
  };
}
