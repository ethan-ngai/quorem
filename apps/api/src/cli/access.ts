/** @file access.ts @description Operator-only audited grants and quotas. @module cli */
import { parseArgs } from "node:util";
import { createHash, randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { createNodePool, withNodeConnection, type ConnectionScope } from "@quorem/database/core";
import { capabilityRepository } from "../adapters/postgres/access/repository.ts";

interface Grant {
  expiresAt?: string;
  operationId: string;
  userId: string;
  actor: string;
  reason: string;
  scope: string;
  source: string;
  reference: string;
  revoke: boolean;
}
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const goJson = (value: unknown) =>
  JSON.stringify(value).replace(
    /[<>&\u2028\u2029]/g,
    (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`,
  );
function expiry(value: string): string {
  const match = /^(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d)(?:\.(\d{1,9}))?(Z|[+-]\d\d:\d\d)$/.exec(value);
  if (!match || !Number.isFinite(Date.parse(value))) throw new Error("Invalid expiry");
  const parts = match[1]!.match(/^(\d{4})-(\d\d)-(\d\d)T(\d\d):(\d\d):(\d\d)$/)!;
  const year = Number(parts[1]),
    month = Number(parts[2]),
    day = Number(parts[3]),
    hour = Number(parts[4]),
    minute = Number(parts[5]),
    second = Number(parts[6]);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0),
    days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > days[month - 1]! ||
    hour > 23 ||
    minute > 59 ||
    second > 59
  )
    throw new Error("Invalid expiry");
  const fraction = match[2]?.replace(/0+$/, "");
  const zone = match[3] === "+00:00" || match[3] === "-00:00" ? "Z" : match[3];
  return `${match[1]}${fraction ? "." + fraction : ""}${zone}`;
}
export function grantFingerprint(grant: Grant): string {
  return hash(goJson(grant));
}
export async function applyAccess(
  scope: ConnectionScope,
  command: string,
  options: {
    user: string;
    scope: string;
    actor: string;
    reason: string;
    opId: string;
    source: string;
    ref: string;
    expires?: string;
    resource: string;
    value: number;
    dry: boolean;
  },
): Promise<void> {
  const o = options;
  if (!["grant", "revoke", "quota"].includes(command)) throw new Error("Unknown operation");
  if (!o.user || !o.actor || !o.reason || !o.opId)
    throw new Error("Operation, target, actor and reason required");
  const grant: Grant = {
    ...(o.expires ? { expiresAt: expiry(o.expires) } : {}),
    operationId: o.opId,
    userId: o.user,
    actor: o.actor,
    reason: o.reason,
    scope: o.scope,
    source: o.source,
    reference: o.ref,
    revoke: command === "revoke",
  };
  if (command !== "quota") {
    if (
      !o.ref ||
      ![
        "admin",
        "internal",
        "matches.host_guests",
        "intelligence.hosted",
        "experimental",
        "interviews.host",
        "questions.custom",
      ].includes(o.scope) ||
      !["manual", "internal", "subscription"].includes(o.source)
    )
      throw new Error("Invalid access grant");
    if (o.scope === "admin" && (grant.expiresAt || o.source === "subscription"))
      throw new Error("Invalid administrator grant");
  } else if (
    !Number.isInteger(o.value) ||
    o.value < 1 ||
    o.value > ({ guest_concurrency: 8, interview_concurrency: 100 }[o.resource] ?? 0)
  )
    throw new Error("Invalid quota override");
  const fingerprint =
    command === "quota"
      ? hash(`${o.user}:${o.resource}:${o.value}:${o.actor}:${o.reason}`)
      : grantFingerprint(grant);
  const rollback = Symbol("dry-run");
  try {
    await scope.transaction({ statementTimeoutMs: 5000, lockTimeoutMs: 2000 }, async (tx) => {
      const rows = (
        await tx.execute<{ kind: string }>(
          sql`SELECT kind FROM users WHERE id=${o.user} FOR UPDATE`,
        )
      ).rows;
      if (rows[0]?.kind !== "account") throw new Error("Account required");
      const prior = (
        await tx.execute<{ scope: string }>(
          sql`SELECT scope FROM access_audit WHERE operation_id=${o.opId}`,
        )
      ).rows[0];
      if (prior) {
        if (prior.scope !== fingerprint) throw new Error("Operation ID already used");
        return;
      }
      if (command === "quota")
        await tx.execute(
          sql`INSERT INTO quota_overrides(user_id,resource,value,actor,reason) VALUES(${o.user},${o.resource},${o.value},${o.actor},${o.reason}) ON CONFLICT(user_id,resource) DO UPDATE SET value=EXCLUDED.value,actor=EXCLUDED.actor,reason=EXCLUDED.reason,expires_at=NULL`,
        );
      else if (o.scope === "admin")
        await tx.execute(
          sql`UPDATE users SET role=${command === "revoke" ? "user" : "admin"} WHERE id=${o.user}`,
        );
      else if (command === "revoke")
        await tx.execute(
          sql`UPDATE entitlement_grants SET revoked_at=clock_timestamp() WHERE user_id=${o.user} AND feature=${o.scope} AND source=${o.source} AND source_ref=${o.ref}`,
        );
      else
        await tx.execute(
          sql`INSERT INTO entitlement_grants(id,user_id,feature,source,source_ref,actor,reason,expires_at) VALUES(${randomUUID()}::uuid,${o.user},${o.scope},${o.source},${o.ref},${o.actor},${o.reason},${grant.expiresAt ?? null}::timestamptz) ON CONFLICT(user_id,feature,source,source_ref) DO UPDATE SET revoked_at=NULL,actor=EXCLUDED.actor,reason=EXCLUDED.reason,expires_at=EXCLUDED.expires_at`,
        );
      const action = command === "quota" ? `quota:${o.resource}` : `${command}:${o.scope}`;
      await tx.execute(
        sql`INSERT INTO access_audit(operation_id,actor,user_id,action,scope,reason) VALUES(${o.opId},${o.actor},${o.user},${action},${fingerprint},${o.reason})`,
      );
      if (o.dry) throw rollback;
    });
  } catch (error) {
    if (error !== rollback) throw error;
  }
}
export async function accessMain(args: string[]): Promise<void> {
  const command = args[0];
  const { values } = parseArgs({
    args: args.slice(1),
    options: {
      user: { type: "string" },
      scope: { type: "string" },
      actor: { type: "string" },
      reason: { type: "string" },
      "op-id": { type: "string" },
      source: { type: "string", default: "manual" },
      ref: { type: "string" },
      expires: { type: "string" },
      resource: { type: "string" },
      value: { type: "string", default: "0" },
      "dry-run": { type: "boolean", default: false },
    },
  });
  if (!/^[+-]?\d+$/.test(values.value!) || !Number.isSafeInteger(Number(values.value)))
    throw new Error("Invalid quota value");
  if (!["inspect", "grant", "revoke", "quota"].includes(command ?? ""))
    throw new Error("Unknown operation");
  const dsn = process.env.QUOREM_OPERATOR_DATABASE_URL;
  if (!dsn) throw new Error("QUOREM_OPERATOR_DATABASE_URL is required");
  const pool = createNodePool({
    connectionString: dsn,
    max: 1,
    connectionTimeoutMs: 5000,
    idleTimeoutMs: 5000,
    onIdleError: () => {},
  });
  try {
    await withNodeConnection(pool, { lifetimeMs: 15000 }, async (scope) => {
      if (command !== "inspect")
        await applyAccess(scope, command!, {
          user: values.user ?? "",
          scope: values.scope ?? "",
          actor: values.actor ?? "",
          reason: values.reason ?? "",
          opId: values["op-id"] ?? "",
          source: values.source!,
          ref: values.ref ?? "",
          expires: values.expires,
          resource: values.resource ?? "",
          value: Number(values.value),
          dry: values["dry-run"]!,
        });
      const user = await scope.transaction(
        { readOnly: true, statementTimeoutMs: 3000, lockTimeoutMs: 1000 },
        async (tx) =>
          (
            await tx.execute<{ role: string; kind: string; bindings: unknown }>(
              sql`SELECT role,kind,COALESCE((SELECT json_agg(json_build_object('issuer',issuer,'subject',subject)) FROM identity_bindings WHERE user_id=u.id),'[]'::json) AS bindings FROM users u WHERE id=${values.user ?? ""}`,
            )
          ).rows[0],
      );
      if (!user) throw new Error("User not found");
      const capabilities = await capabilityRepository(scope).capabilities(values.user!);
      process.stdout.write(
        `${JSON.stringify({ userId: values.user, role: user.role, kind: user.kind, bindings: user.bindings, capabilities, dryRun: values["dry-run"] })}\n`,
      );
    });
  } finally {
    await pool.end();
  }
}
if (import.meta.main)
  try {
    await accessMain(process.argv.slice(2));
  } catch {
    console.error("Operator command failed");
    process.exitCode = 1;
  }
