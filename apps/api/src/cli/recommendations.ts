/** @file recommendations.ts @description Evaluated training, measurement and model rollback. @module cli */
import { createNodePool, withNodeConnection, type Transaction } from "@quorem/database/core";
import {
  activeModel,
  learningEvents,
} from "../adapters/postgres/problems/recommendations/repository.ts";
import {
  activateModel,
  saveTraining,
} from "../adapters/postgres/problems/recommendations/training.ts";
import { recommendationMeasurement } from "../adapters/postgres/problems/recommendations/measurement.ts";
import { train } from "../modules/problems/recommendations/training.ts";

async function main() {
  const [action = "train", argument] = process.argv.slice(2);
  if (!["train", "evaluate", "measure", "activate"].includes(action) || !process.env.DATABASE_URL)
    throw new Error(
      "Use DATABASE_URL and recommendations.ts train|evaluate|measure|activate <id|prior>",
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
    if (action === "measure") {
      console.log(JSON.stringify(await transact(recommendationMeasurement, true)));
      return;
    }
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
    const snapshot = await transact(
      async (tx) => ({ active: await activeModel(tx), events: await learningEvents(tx, null) }),
      true,
    );
    const result = train(snapshot.events, snapshot.active.model, Date.now());
    const saved =
      action === "evaluate" || result.reason === "insufficient_evidence"
        ? undefined
        : await transact((tx) => saveTraining(tx, result, snapshot.active.id));
    const { model: _model, ...report } = result;
    console.log(JSON.stringify({ ...saved, ...report }));
  } finally {
    await pool.end();
  }
}
if (import.meta.main)
  main().catch(() => {
    console.error(
      "Recommendation maintenance failed; verify database migrations and connectivity.",
    );
    process.exitCode = 1;
  });
