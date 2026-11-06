/** @file recommendations.ts @description Local CPU embedding refresh, evaluated training and model rollback. @module cli */
import { resolve } from "node:path";
import { createNodePool, withNodeConnection, type Transaction } from "@quorem/database/core";
import { localQuestionEncoder } from "../adapters/learning/local-encoder.ts";
import {
  pendingEmbeddings,
  saveEmbedding,
} from "../adapters/postgres/problems/recommendations/embeddings.ts";
import {
  activeModel,
  learningEvents,
} from "../adapters/postgres/problems/recommendations/repository.ts";
import {
  activateModel,
  saveTraining,
} from "../adapters/postgres/problems/recommendations/training.ts";
import { train } from "../modules/problems/recommendations/training.ts";

async function main() {
  const [action = "refresh", argument] = process.argv.slice(2);
  if (!["refresh", "train", "evaluate", "activate"].includes(action) || !process.env.DATABASE_URL)
    throw new Error(
      "Use DATABASE_URL and recommendations.ts refresh|train|evaluate|activate <id|prior>",
    );
  const pool = createNodePool({
    connectionString: process.env.DATABASE_URL,
    max: 2,
    connectionTimeoutMs: 5000,
    idleTimeoutMs: 1000,
    onIdleError: () => {},
  });
  const transact = <T>(fn: (tx: Transaction) => Promise<T>, readOnly = false) =>
    withNodeConnection(pool, { lifetimeMs: 120000 }, (scope) =>
      scope.transaction(
        { statementTimeoutMs: 60000, lockTimeoutMs: 3000, readOnly, isolation: "repeatable read" },
        fn,
      ),
    );
  try {
    if (action === "activate") {
      if (
        argument !== "prior" &&
        !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(argument ?? "")
      )
        throw new Error("Model id or prior required");
      await transact((tx) => activateModel(tx, argument === "prior" ? null : argument));
      console.log(JSON.stringify({ activated: argument }));
      return;
    }
    let encoded = 0;
    if (action === "refresh") {
      let batch = await transact((tx) => pendingEmbeddings(tx), true);
      if (batch.length) {
        const extractor = await localQuestionEncoder(
          process.env.QUOREM_MODEL_CACHE ?? resolve(".local/models"),
        );
        // Bound each invocation; the next scheduled run resumes remaining revisions.
        for (let round = 0; batch.length && round < 100; round++) {
          const vectors = await extractor.encode(batch.map((row) => row.text));
          for (let i = 0; i < batch.length; i++)
            if (await transact((tx) => saveEmbedding(tx, batch[i], vectors[i]))) encoded++;
          batch = await transact((tx) => pendingEmbeddings(tx), true);
        }
      }
    }
    const snapshot = await transact(
      async (tx) => ({ active: await activeModel(tx), events: await learningEvents(tx, null) }),
      true,
    );
    const result = train(snapshot.events, snapshot.active.model, Date.now());
    const saved =
      action === "evaluate"
        ? undefined
        : await transact((tx) => saveTraining(tx, result, snapshot.active.id));
    const { model: _model, ...report } = result;
    console.log(JSON.stringify({ encoded, ...saved, ...report }));
  } finally {
    await pool.end();
  }
}
if (import.meta.main)
  main().catch(() => {
    console.error(
      "Recommendation maintenance failed; verify database migrations, connectivity and local model availability.",
    );
    process.exitCode = 1;
  });
