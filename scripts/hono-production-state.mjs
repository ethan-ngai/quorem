/** Read the active native deployment state without mutating infrastructure. */
import { z } from "zod";
import { terraformBackendArgs } from "./hono-terraform-backend.mjs";
import { runStageCommand } from "./hono-stage-command.mjs";

const activation = z.object({
  activation: z.object({ value: z.object({ phase: z.literal("active") }) }),
  secrets: z.object({ value: z.record(z.string(), z.string()) }),
});
const postgres = z.url({ protocol: /^postgres(?:ql)?$/, hostname: /\.neon\.tech$/ });

export function productionOutputs(env, directory, key = directory) {
  runStageCommand("terraform", terraformBackendArgs(env, directory, key), env);
  return JSON.parse(
    runStageCommand("terraform", [`-chdir=infra/terraform/${directory}`, "output", "-json"], env),
  );
}

export function parseActiveProduction(outputs) {
  const state = activation.safeParse(outputs);
  if (!state.success) throw new Error("Native production state is not active");
  const keys = state.data.secrets.value;
  const connection = postgres.safeParse(keys.DATABASE_URL);
  if (!connection.success) throw new Error("Unexpected production database");
  const database = new URL(connection.data);
  if (database.pathname !== "/neondb") throw new Error("Unexpected production database");
  return { keys, database };
}

export function activeProduction(env) {
  return parseActiveProduction(productionOutputs(env, "hono-production"));
}
