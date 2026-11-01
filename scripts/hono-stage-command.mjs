/** Bounded stage subprocesses; expose fixed provider metadata only. */
import { spawnSync } from "node:child_process";
export const bootstrapResources = [
  "data.neon_branches.existing",
  "restapi_object.stage_branch",
  "neon_role.stage",
  "neon_database.stage",
  "terraform_data.stage_secrets",
];
const commandResources = [
  ...bootstrapResources,
  "cloudflare_hyperdrive_config.database",
  "cloudflare_worker.api",
  "cloudflare_queue.execution",
  "cloudflare_queue.dead_letter",
  "cloudflare_queue_consumer.execution",
  "cloudflare_r2_bucket.profile",
  "cloudflare_worker.services",
  "terraform_data.case_namespace_pin",
  "cloudflare_worker_version.services",
  "restapi_object.trusted",
  "restapi_object.trusted_rollout",
  "restapi_object.case",
  "terraform_data.case_images",
  "cloudflare_workers_custom_domain.service",
];

function providerDiagnostics(text, redactions) {
  // Non-color Terraform omits box borders; split its plain Error headings as well.
  return text
    .replace(/^[ \t]*[│╷╵][ \t]?/gm, "")
    .split(/(?=^Error:)/m)
    .filter(Boolean)
    .map((chunk) => {
      const resources = commandResources.filter((name) => chunk.includes(name));
      const statuses = [
        ...chunk.matchAll(
          /\b(?:HTTP(?:\s+status)?|status(?:\s+code)?|response\s+code)\s*[:=]?\s*['"]?(400|401|403|404|409|422|423|429|500|502|503|504)\b/gi,
        ),
      ].map((match) => Number(match[1]));
      const codes =
        resources.length > 0
          ? [...chunk.matchAll(/(?:"code"\s*:\s*|\berror\s+code\s*[:=]\s*)(\d{1,6})\b/gi)].map(
              (match) => Number(match[1]),
            )
          : [];
      const flags = {
        schemaOnly: /schema[-_]only|parent[-_]schema/i.test(chunk),
        parent: /parent_id|parent branch.*required|parent.*not found/i.test(chunk),
        feature: /not supported|unsupported|not available|not enabled|early access|\bbeta\b/i.test(
          chunk,
        ),
        organization: /\b(?:(?:organization|organisation|org)[ -]scoped|org_id)\b/i.test(chunk),
        project: /\bproject[ -]scoped\b/i.test(chunk),
        authentication:
          /\b(?:unauthorized|unauthenticated|authentication failed|invalid (?:api )?(?:key|token))\b/i.test(
            chunk,
          ),
        permission:
          /\b(?:permission denied|insufficient permissions?|access denied|forbidden|not authorized)\b/i.test(
            chunk,
          ),
        quota:
          /\b(?:quota (?:exceeded|limit)|rate[ -]limit(?:ed| exceeded)?|too many requests)\b/i.test(
            chunk,
          ),
      };
      // Neon documents this field as a machine-readable error code, never response prose.
      const types = [...chunk.matchAll(/"code"\s*:\s*"([A-Za-z][A-Za-z0-9_]{1,79})"/g)].map(
        (match) => match[1],
      );
      // Only bounded server messages are exposed; resource payloads remain private.
      const messages =
        resources.length > 0 &&
        resources.every((name) =>
          [
            "restapi_object.stage_branch",
            "restapi_object.trusted",
            "restapi_object.trusted_rollout",
            "restapi_object.case",
          ].includes(name),
        )
          ? [...chunk.matchAll(/"message"\s*:\s*("(?:[^"\\]|\\.)*")/g)]
              .slice(0, 4)
              .flatMap((match) => {
                let message;
                try {
                  message = JSON.parse(match[1]);
                } catch {
                  return [];
                }
                for (const value of redactions) message = message.replaceAll(value, "[redacted]");
                return [
                  message
                    .replace(/-----BEGIN [\s\S]*?-----END [^-]+-----/g, "[redacted]")
                    .replace(/(?:https?|postgres(?:ql)?):\/\/\S+/gi, "[redacted]")
                    .replace(/\S*(?:secret|token|password|credential)\S*/gi, "[redacted]")
                    .replace(/[A-Za-z0-9_+/=.:-]{24,}/g, "[redacted]")
                    .replace(/\S+@\S+/g, "[redacted]")
                    .replace(/\p{Cc}/gu, " ")
                    .replace(/\s+/g, " ")
                    .slice(0, 300),
                ];
              })
          : [];
      return {
        resources,
        statuses: [...new Set(statuses)],
        codes: [...new Set(codes)],
        types: [...new Set(types)],
        messages,
        flags,
      };
    })
    .filter(
      (item) =>
        item.resources.length ||
        item.statuses.length ||
        item.codes.length ||
        item.types.length ||
        Object.values(item.flags).some(Boolean),
    );
}
export class StageCommandFailure extends Error {
  constructor(result, secrets = []) {
    const text = result.stderr ?? "";
    const redactions = secrets
      .filter((value) => typeof value === "string" && value.length >= 4)
      .sort((a, b) => b.length - a.length);
    const diagnostics = providerDiagnostics(text, redactions);
    const category = diagnostics.some(
      ({ statuses, flags }) =>
        flags.authentication ||
        flags.permission ||
        statuses.some((status) => status === 401 || status === 403),
    )
      ? "provider permission"
      : diagnostics.some(({ statuses, flags }) => flags.quota || statuses.includes(429))
        ? "provider limit"
        : "configuration/provider";
    super(`Stage command failed (${category}); output withheld`);
    this.category = category;
    this.diagnostics = diagnostics;
    this.resources = commandResources.filter((name) => text.includes(name));
    this.noState = /No state file was found/i.test(text);
  }
}
export function runStageCommand(program, args, env, execute = spawnSync, input) {
  const result = execute(program, args, {
    env,
    input,
    encoding: "utf8",
    stdio: [input === undefined ? "ignore" : "pipe", "pipe", "pipe"],
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.error || result.status !== 0)
    throw new StageCommandFailure(result, Object.values(env));
  return result.stdout ?? "";
}
