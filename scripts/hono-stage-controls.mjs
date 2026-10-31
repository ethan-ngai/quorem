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
        void reader.cancel().catch(() => {});
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
  const request = async (kind, action, payload, after) => {
    const origin = kind === "case" ? caseOrigin : runnerOrigin,
      access = kind === "case" ? caseAccess : runnerAccess,
      nonce = randomUUID();
    const url = new URL(`${origin}/internal/control/${kind}/${action}`);
    if (action === "inventory") {
      url.searchParams.set("limit", "4");
      if (after) url.searchParams.set("after", after);
    }
    const response = await send(url.href, {
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
      const probeKind =
        action === "inventory"
          ? "control-inventory"
          : kind === "case"
            ? "control-state"
            : "runner-control-state";
      const { value, envelope } = await readVerifiedCaseProbe(response, {
        publicKey: key,
        kind: probeKind,
        scope,
        attempt: kind === "case" ? "control" : "runner-control",
        nonce,
        expectedNamespace: namespace,
        ...(action === "inventory" ? { expectedAfter: after } : {}),
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
  const inventoryPage = async (after = "") => {
    if (typeof after !== "string" || (after !== "" && !/^[A-Za-z0-9-]{1,128}$/.test(after)))
      throw new Error("Invalid inventory cursor");
    const start = proofs.length;
    const page = await request("case", "inventory", undefined, after);
    return { ...page, proof: proofs.splice(start)[0] };
  };
  const state = () => Promise.all([request("runner", "state"), request("case", "state")]);
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
  const operation = (value) => {
    if (typeof value !== "string" || !uuid.test(value))
      throw new Error("Invalid control operation");
  };
  const priorValid = (prior) => {
    if (
      !prior ||
      !Number.isSafeInteger(prior.generation) ||
      prior.generation < 1 ||
      prior.generation >= Number.MAX_SAFE_INTEGER - 1 ||
      !/^[a-f0-9]{40}$/.test(prior.release ?? "") ||
      !/^[a-f0-9]{64}$/.test(prior.bindings ?? "") ||
      !/^[a-f0-9]{40}$/.test(prior.initialRelease ?? "")
    )
      throw new Error("Invalid prior control state");
    operation(prior.initialOperation);
  };
  const observe = async () => {
    const start = proofs.length;
    const [runner, cases] = await state();
    return { runner, cases, proofs: proofs.splice(start) };
  };
  const matching = (row, generation, expectedRelease, expectedBindings) =>
    row.generation === generation &&
    row.release === expectedRelease &&
    row.bindings === expectedBindings;
  const genesis = (row, prior) =>
    row.initialOperation === prior.initialOperation && row.initialRelease === prior.initialRelease;
  /** Caller must independently establish teardown before using the resume transitions. */
  const prepareResume = async ({ prior, operation: id, caseOperation }) => {
    priorValid(prior);
    operation(id);
    const observed = await observe(),
      next = prior.generation + 1;
    const caseBefore = (row) =>
      row.paused && matching(row, prior.generation, prior.release, prior.bindings);
    const caseAfter = (row) =>
      !row.paused &&
      matching(row, next, release, bindings) &&
      typeof caseOperation === "string" &&
      uuid.test(caseOperation) &&
      row.activationOperation === caseOperation;
    const runnerAfter = (row) =>
      ["prepared", "active"].includes(row.status) && matching(row, next, release, bindings);
    const consistent = (snapshot) =>
      runnerAfter(snapshot.runner) &&
      (caseAfter(snapshot.cases) ||
        (snapshot.runner.status === "prepared" && caseBefore(snapshot.cases)));
    if (
      !genesis(observed.cases, prior) ||
      !(
        (caseBefore(observed.cases) &&
          observed.runner.status === "paused" &&
          matching(observed.runner, prior.generation, prior.release, prior.bindings)) ||
        consistent(observed)
      )
    )
      throw new Error("Unexpected prior control state");
    const receipt = await request("runner", "prepare", {
      operationId: id,
      expectedGeneration: prior.generation,
      release,
      bindings,
    });
    if (
      receipt?.status !== "prepared" ||
      !matching(receipt, next, release, bindings) ||
      !uuid.test(receipt.token ?? "")
    )
      throw new Error("Invalid preparation receipt");
    const after = await observe();
    if (!consistent(after) || !genesis(after.cases, prior))
      throw new Error("Unexpected prepared control state");
    return { token: receipt.token, observed: after };
  };
  const activateCaseResume = async ({ prior, operation: id }) => {
    priorValid(prior);
    operation(id);
    const before = await observe(),
      next = prior.generation + 1;
    if (
      !["prepared", "active"].includes(before.runner.status) ||
      !matching(before.runner, next, release, bindings) ||
      !genesis(before.cases, prior) ||
      !(
        (before.runner.status === "prepared" &&
          before.cases.paused &&
          matching(before.cases, prior.generation, prior.release, prior.bindings)) ||
        (!before.cases.paused &&
          matching(before.cases, next, release, bindings) &&
          before.cases.activationOperation === id)
      )
    )
      throw new Error("Unexpected case control state");
    await request("case", "activate", {
      operation: id,
      expectedGeneration: prior.generation,
      release,
      bindings,
    });
    const after = await observe();
    if (
      after.runner.status !== before.runner.status ||
      !matching(after.runner, next, release, bindings) ||
      after.cases.paused ||
      !matching(after.cases, next, release, bindings) ||
      after.cases.activationOperation !== id ||
      !genesis(after.cases, prior)
    )
      throw new Error("Unexpected active case state");
    return after;
  };
  const activateRunnerResume = async ({ prior, operation: id, caseOperation, token }) => {
    priorValid(prior);
    operation(id);
    operation(caseOperation);
    operation(token);
    const before = await observe(),
      next = prior.generation + 1;
    if (
      !genesis(before.cases, prior) ||
      before.cases.paused ||
      !matching(before.cases, next, release, bindings) ||
      before.cases.activationOperation !== caseOperation ||
      !["prepared", "active"].includes(before.runner.status) ||
      !matching(before.runner, next, release, bindings)
    )
      throw new Error("Unexpected runner control state");
    await request("runner", "activate", {
      operationId: id,
      generation: next,
      release,
      bindings,
      token,
    });
    const after = await observe();
    if (
      after.runner.status !== "active" ||
      !matching(after.runner, next, release, bindings) ||
      after.cases.paused ||
      !matching(after.cases, next, release, bindings) ||
      after.cases.activationOperation !== caseOperation ||
      !genesis(after.cases, prior)
    )
      throw new Error("Unexpected activated control state");
    return after;
  };
  const pausePinned = async ({ prior, runnerOperation, caseOperation }) => {
    priorValid(prior);
    operation(runnerOperation);
    operation(caseOperation);
    const start = proofs.length;
    const transitions = await Promise.allSettled([
      (async () => {
        const before = await request("runner", "state");
        if (
          !matching(before, prior.generation, prior.release, prior.bindings) ||
          !["active", "paused"].includes(before.status)
        )
          throw new Error("Unexpected runner state");
        await request("runner", "pause", {
          operationId: runnerOperation,
          generation: prior.generation,
        });
      })(),
      (async () => {
        const before = await request("case", "state");
        if (
          !genesis(before, prior) ||
          !matching(before, prior.generation, prior.release, prior.bindings) ||
          (before.paused && before.pauseOperation !== caseOperation)
        )
          throw new Error("Unexpected case state");
        await request("case", "pause", {
          operation: caseOperation,
          expectedGeneration: prior.generation,
        });
      })(),
    ]);
    const states = await Promise.allSettled([request("runner", "state"), request("case", "state")]);
    const captured = proofs.splice(start);
    if (
      transitions.some((item) => item.status === "rejected") ||
      states.some((item) => item.status === "rejected")
    )
      throw new Error("Control pause unconfirmed");
    const runner = states[0].value,
      cases = states[1].value;
    if (
      runner.status !== "paused" ||
      !matching(runner, prior.generation, prior.release, prior.bindings) ||
      !cases.paused ||
      !matching(cases, prior.generation, prior.release, prior.bindings) ||
      cases.pauseOperation !== caseOperation ||
      !genesis(cases, prior)
    )
      throw new Error("Control pause unconfirmed");
    return { runner, cases, proofs: captured };
  };
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
  return {
    activate,
    pause,
    observe,
    inventoryPage,
    pausePinned,
    prepareResume,
    activateCaseResume,
    activateRunnerResume,
  };
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
