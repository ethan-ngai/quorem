/** Initial control activation; signed observations fence every durable transition. */
import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { stageRoleCredentials } from "./hono-stage-database-role.mjs";
import { fenceStageRuntime } from "./hono-stage-recovery-fence.mjs";
import { readVerifiedCaseProbe } from "../deploy/case-proof.js";

async function boundedJSON(response) {
  if (!response.body) throw new Error("Missing control receipt");
  const reader = response.body.getReader(),
    chunks = [];
  let size = 0;
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > 2048) {
        await reader.cancel();
        throw new Error("Oversized control receipt");
      }
      chunks.push(part.value);
    }
  } finally {
    reader.releaseLock();
  }
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)));
}
export async function stageControls(options, send = fetch) {
  const {
    namespace,
    scope,
    release,
    bindings,
    secret,
    caseOrigin,
    runnerOrigin,
    caseAccess,
    runnerAccess,
    publicKeyFile,
  } = options;
  if (
    !/^[a-f0-9]{64}$/.test(namespace) ||
    namespace === "0".repeat(64) ||
    !/^remote:[a-f0-9]{64}$/.test(scope) ||
    !/^[a-f0-9]{40}$/.test(release) ||
    !/^[a-f0-9]{64}$/.test(bindings) ||
    typeof secret !== "string" ||
    secret.length < 32
  )
    throw new Error("Invalid control bindings");
  for (const [origin, access] of [
    [caseOrigin, caseAccess],
    [runnerOrigin, runnerAccess],
  ]) {
    const parsed = new URL(origin);
    if (parsed.protocol !== "https:" || parsed.origin !== origin || !access?.id || !access?.secret)
      throw new Error("Invalid control transport");
  }
  const pem = await readFile(publicKeyFile, "utf8");
  const encoded = pem.replace(/-----BEGIN PUBLIC KEY-----|-----END PUBLIC KEY-----|\s/g, "");
  const key = await crypto.subtle.importKey(
    "spki",
    Buffer.from(encoded, "base64"),
    "Ed25519",
    false,
    ["verify"],
  );
  const ops = {
    prepare: randomUUID(),
    genesis: randomUUID(),
    caseActivate: randomUUID(),
    runnerActivate: randomUUID(),
    casePause: randomUUID(),
    runnerPause: randomUUID(),
  };
  const proofs = [];
  const request = async (kind, action, payload) => {
    const origin = kind === "case" ? caseOrigin : runnerOrigin,
      access = kind === "case" ? caseAccess : runnerAccess,
      nonce = randomUUID();
    const response = await send(`${origin}/internal/control/${kind}/${action}`, {
      method: payload ? "POST" : "GET",
      headers: {
        authorization: `Bearer ${secret}`,
        "CF-Access-Client-Id": access.id,
        "CF-Access-Client-Secret": access.secret,
        "x-quorem-owner-scope": scope,
        "x-quorem-owner-nonce": nonce,
        ...(payload ? { "content-type": "application/json" } : {}),
      },
      ...(payload ? { body: JSON.stringify(payload) } : {}),
      redirect: "error",
      signal: AbortSignal.timeout(10000),
    });
    if (!payload) {
      const probeKind = kind === "case" ? "control-state" : "runner-control-state";
      const { value, envelope } = await readVerifiedCaseProbe(response, {
        publicKey: key,
        kind: probeKind,
        scope,
        attempt: kind === "case" ? "control" : "runner-control",
        nonce,
        expectedNamespace: namespace,
      });
      proofs.push(envelope);
      return value;
    }
    if (!response.ok) throw new Error("Control transition rejected");
    if (action === "prepare") {
      return boundedJSON(response);
    }
    await response.body?.cancel();
  };
  const state = () => Promise.all([request("runner", "state"), request("case", "state")]);
  const checkRunner = (row, status, generation) => {
    if (
      row.status !== status ||
      row.generation !== generation ||
      (generation > 0 && (row.release !== release || row.bindings !== bindings))
    )
      throw new Error("Unexpected runner state");
  };
  const checkCase = (row, active) => {
    if (
      row.initialOperation !== ops.genesis ||
      row.initialRelease !== release ||
      row.generation !== (active ? 1 : 0) ||
      row.paused === active ||
      (active &&
        (row.release !== release ||
          row.bindings !== bindings ||
          row.activationOperation !== ops.caseActivate))
    )
      throw new Error("Unexpected case state");
  };
  const activate = async () => {
    const initial = await request("runner", "state");
    checkRunner(initial, "paused", 0);
    const prepared = await request("runner", "prepare", {
      operationId: ops.prepare,
      expectedGeneration: 0,
      release,
      bindings,
    });
    if (
      prepared?.status !== "prepared" ||
      prepared.generation !== 1 ||
      prepared.release !== release ||
      prepared.bindings !== bindings ||
      !/^[0-9a-f-]{36}$/.test(prepared.token ?? "")
    )
      throw new Error("Invalid preparation receipt");
    checkRunner(await request("runner", "state"), "prepared", 1);
    await request("case", "initialize", { namespace, scope, operation: ops.genesis, release });
    let [runner, cases] = await state();
    checkRunner(runner, "prepared", 1);
    checkCase(cases, false);
    await request("case", "activate", {
      bindings,
      expectedGeneration: 0,
      operation: ops.caseActivate,
      release,
    });
    [runner, cases] = await state();
    checkRunner(runner, "prepared", 1);
    checkCase(cases, true);
    await request("runner", "activate", {
      operationId: ops.runnerActivate,
      generation: 1,
      release,
      bindings,
      token: prepared.token,
    });
    [runner, cases] = await state();
    checkRunner(runner, "active", 1);
    checkCase(cases, true);
    return {
      namespace,
      scope,
      release,
      bindings,
      generation: 1,
      genesisOperation: ops.genesis,
      caseOperation: ops.caseActivate,
      runnerOperation: ops.runnerActivate,
      ownerKeySha256: createHash("sha256").update(Buffer.from(encoded, "base64")).digest("hex"),
      proofs,
    };
  };
  const pause = async () => {
    let confirmed = true;
    try {
      const runner = await request("runner", "state");
      if (runner.generation === 1 && runner.status !== "paused")
        await request("runner", "pause", { operationId: ops.runnerPause, generation: 1 });
      const after = await request("runner", "state");
      if (
        after.status !== "paused" ||
        ![0, 1].includes(after.generation) ||
        (after.generation === 1 && (after.release !== release || after.bindings !== bindings))
      )
        confirmed = false;
    } catch {
      confirmed = false;
    }
    try {
      const cases = await request("case", "state");
      if (!cases.paused && cases.generation === 1)
        await request("case", "pause", { operation: ops.casePause, expectedGeneration: 1 });
      const after = await request("case", "state");
      if (
        !after.paused ||
        ![0, 1].includes(after.generation) ||
        after.initialOperation !== ops.genesis ||
        after.initialRelease !== release
      )
        confirmed = false;
    } catch {
      confirmed = false;
    }
    if (!confirmed) throw new Error("Control pause unconfirmed");
  };
  return { activate, pause };
}

/** Failure compensation never interprets an absent or unreachable role as fenced. */
export async function fenceFailedStageRuntime(env) {
  const { operator, role } = stageRoleCredentials(env);
  const { Client } = createRequire(new URL("../packages/database/package.json", import.meta.url))(
    "pg",
  );
  const client = new Client({ connectionString: operator, connectionTimeoutMillis: 5000 });
  try {
    await client.connect();
    return await fenceStageRuntime(client, role);
  } catch {
    throw new Error("Stage runtime writer fence unconfirmed");
  } finally {
    await client.end().catch(() => {});
  }
}
