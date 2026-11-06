/** Read-only private mail ingress probe; credentials and response bodies stay private. */
import { runStageCommand } from "./hono-stage-command.mjs";
import { terraformBackendArgs } from "./hono-terraform-backend.mjs";
runStageCommand("terraform", terraformBackendArgs(process.env, "hono-production"), process.env);
const state = JSON.parse(
  runStageCommand(
    "terraform",
    ["-chdir=infra/terraform/hono-production", "output", "-json"],
    process.env,
  ),
);
const token = state.secrets.value.MAIL_RELAY_TOKEN;
if (typeof token !== "string" || token.length < 32) throw new Error("Mail credential unavailable");
for (let attempt = 1; attempt <= 3; attempt++) {
  const started = Date.now();
  try {
    const response = await fetch("https://mail-hono.quorem.app/internal/mail/health", {
      headers: { authorization: `Bearer ${token}` },
      redirect: "error",
      signal: AbortSignal.timeout(40000),
    });
    console.log(
      JSON.stringify({ attempt, status: response.status, elapsedMs: Date.now() - started }),
    );
    await response.body?.cancel();
  } catch {
    console.log(
      JSON.stringify({ attempt, status: "transport-failed", elapsedMs: Date.now() - started }),
    );
  }
}
