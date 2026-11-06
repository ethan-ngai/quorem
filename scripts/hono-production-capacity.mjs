/** Production database capacity; Terraform retains authority over the Hyperdrive configuration. */
import {
  productionTerraform,
  PRODUCTION_DATABASE_CONNECTIONS,
} from "./hono-production-terraform.mjs";

export async function configureProductionHyperdrive(env, inputs, dependencies = {}) {
  const send = dependencies.fetch ?? fetch;
  const provision = dependencies.terraform ?? productionTerraform;
  if (!/^[a-f0-9]{32}$/.test(inputs.id ?? "")) throw new Error("Invalid production Hyperdrive");
  const read = async () => {
    const response = await send(
      `https://api.cloudflare.com/client/v4/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/hyperdrive/configs/${inputs.id}`,
      {
        headers: { authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}` },
        signal: AbortSignal.timeout(15000),
      },
    );
    if (!response.ok) throw new Error("Production Hyperdrive settings unavailable");
    return (await response.json()).result;
  };
  const config = await read();
  if (
    config?.name !== "quorem-hono-production-database" ||
    config.origin?.user !== inputs.role ||
    config.origin?.database !== "neondb" ||
    !Number.isSafeInteger(config.origin_connection_limit) ||
    config.origin_connection_limit < 5 ||
    config.origin_connection_limit > 100
  )
    throw new Error("Unexpected production Hyperdrive configuration");
  const capacity = Math.max(PRODUCTION_DATABASE_CONNECTIONS, config.origin_connection_limit);
  if (!Number.isSafeInteger(inputs.maxConnections) || inputs.maxConnections < capacity + 16)
    throw new Error("Insufficient database connection headroom");
  await provision(
    {
      ...env,
      TF_VAR_deployment_scope: "production",
      TF_VAR_account_id: env.CLOUDFLARE_ACCOUNT_ID,
      TF_VAR_worker_name: "quorem-hono-production",
      TF_VAR_stage_hostname: "api-hono.quorem.app",
      TF_VAR_database_host: config.origin.host,
      TF_VAR_database_port: String(config.origin.port),
      TF_VAR_database_name: "neondb",
      TF_VAR_database_user: inputs.role,
      TF_VAR_database_password: inputs.password,
      TF_VAR_database_connection_limit: String(capacity),
      TF_VAR_profile_media_enabled: "true",
      TF_VAR_enable_queue_consumer: "true",
    },
    "hono-stage",
    "hono-production-api",
    {
      targets: ["cloudflare_hyperdrive_config.database"],
      mode: "hyperdrive-capacity",
      label: "production-hyperdrive-capacity",
    },
  );
  const live = await read();
  if (
    !Number.isSafeInteger(live?.origin_connection_limit) ||
    live.origin_connection_limit < capacity ||
    live.origin_connection_limit > 100 ||
    live?.name !== config.name ||
    ["scheme", "host", "port", "database", "user"].some(
      (key) => live?.origin?.[key] !== config.origin[key],
    )
  )
    throw new Error("Production Hyperdrive capacity did not verify");
  console.log(
    JSON.stringify({
      phase: "production-database-capacity",
      originConnections: live.origin_connection_limit,
      databaseMaximum: inputs.maxConnections,
    }),
  );
}
