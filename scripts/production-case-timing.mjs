/** @file production-case-timing.mjs @description Measure a sealed Python timeout case in a disposable sandbox. @module deployment */
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { Readable } from "node:stream";
import { buffer } from "node:stream/consumers";
import { setTimeout as delay } from "node:timers/promises";
import { nativeCaseLimits, readBudgetJson } from "../apps/runner/src/engine/case-budget.ts";
import { streamedCaseRequest } from "../apps/runner/src/engine/request-stream.ts";
import { readinessBudget } from "../apps/runner/src/sandbox/budget.ts";
import { decodeCaseFrames, encodeCaseFrame } from "../packages/execution/src/frames.ts";

const { Client } = createRequire(new URL("../packages/database/package.json", import.meta.url))(
  "pg",
);
const matchId = process.env.QUOREM_DIAGNOSTIC_MATCH_ID;
if (!/^[a-f0-9-]{36}$/.test(matchId ?? "")) throw new Error("Match ID required");
const db = new Client({ connectionString: process.env.DATABASE_URL, statement_timeout: 5000 });

function spool(value) {
  return {
    stream(start = 0, length = value.length - start) {
      return Readable.from([value.subarray(start, start + length)]);
    },
  };
}

async function storedCase() {
  await db.connect();
  try {
    await db.query("BEGIN READ ONLY");
    const {
      rows: [row],
    } = await db.query(
      `SELECT j.language, j.runtime_revision, j.harness_revision, j.automatic_imports,
              s.odyssey_level, p.limits, c.ordinal, src.data AS source,
              meta.data AS metadata, test.data AS testcase
       FROM workspaces w JOIN submissions s ON s.workspace_id=w.id
       JOIN execution_jobs j ON j.submission_id=s.id
       JOIN runner_job_inputs i ON i.job_id=j.id AND i.sealed
       JOIN question_publications p ON p.id=i.publication_id
       JOIN execution_verified_cases v ON v.job_id=j.id AND v.status='time_limit'
       JOIN runner_job_input_cases c ON c.job_id=j.id AND c.ordinal=v.ordinal
       JOIN runner_input_blobs src ON src.hash=i.source_hash
       JOIN runner_input_blobs meta ON meta.hash=i.metadata_hash
       JOIN runner_input_blobs test ON test.hash=c.blob_hash
       WHERE w.review_match_id=$1::uuid AND s.kind='submit' AND j.language='python'
       ORDER BY s.admitted_at DESC, c.ordinal LIMIT 1`,
      [matchId],
    );
    return row;
  } finally {
    await db.end();
  }
}

const measure = `
import json, resource, subprocess, sys, time
with subprocess.Popen([sys.executable, '-B', '/opt/quorem/harness.py'],
                      stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                      stderr=subprocess.DEVNULL) as child:
    payload = sys.stdin.buffer.read()
    if child.stdout.read(1) != b'\\0':
        raise SystemExit(1)
    ready_cpu = time.clock_gettime_ns(time.clock_getcpuclockid(child.pid)) / 1e9
    start = time.monotonic()
    output, _ = child.communicate(payload, timeout=5)
    wall = time.monotonic() - start
    usage = resource.getrusage(resource.RUSAGE_CHILDREN)
    status = json.loads(output)['status']
    print(json.dumps({'cpuMs': round(1000 * (usage.ru_utime + usage.ru_stime - ready_cpu), 2),
                      'wallMs': round(1000 * wall, 2),
                      'executed': child.returncode == 0 and status == 'executed'}))
`;

/** Reproduce a spurious deadline by withholding the exit frame after output is available. */
async function exitDelivery(wallMs, delayMs) {
  const budget = readinessBudget({ initialMs: 1000, compileMs: 1000, wallMs, markers: 1 });
  async function* frames() {
    yield encodeCaseFrame(1, Uint8Array.of(0));
    yield encodeCaseFrame(1, Uint8Array.of(65));
    await delay(delayMs);
    yield encodeCaseFrame(3, new Uint8Array(4));
    yield encodeCaseFrame(4, new Uint8Array());
  }
  try {
    await decodeCaseFrames(
      frames(),
      { stdoutBytes: 16, stderrBytes: 16 },
      async (channel, data) => {
        if (channel === "stdout") budget.observe(data);
      },
      budget.signal,
      budget.close,
    );
    return "completed";
  } catch (error) {
    if (budget.deadline()?.phase === "case") return "time_limit";
    throw error;
  } finally {
    budget.close();
  }
}

async function main() {
  const row = await storedCase();
  if (row?.runtime_revision !== "python-3.12-v1" || row.harness_revision !== "quorem-harness-v2")
    throw new Error("Stored case unavailable for this Python image");
  const metadata = spool(row.metadata);
  const request = await streamedCaseRequest({
    source: spool(row.source),
    metadata,
    testcase: spool(row.testcase),
    level: row.odyssey_level,
    operation: "direct",
    language: row.language,
    automaticImports: row.automatic_imports ?? undefined,
  });
  const budgetSpan = request.metadata.caseBudget;
  const raw = budgetSpan
    ? await readBudgetJson(metadata.stream(budgetSpan.start, budgetSpan.length), 8192)
    : undefined;
  const limits = await nativeCaseLimits(
    { limits: row.limits, runtimeRevision: row.runtime_revision },
    raw ? JSON.parse(raw) : undefined,
    request.testcase.args,
    false,
  );
  const input = await buffer(Readable.from(request.input.open()));
  const samples = [];
  for (let sample = 0; sample < 10; sample++) {
    const run = spawnSync(
      "docker",
      [
        "run",
        "--rm",
        "-i",
        "--network=none",
        "--read-only",
        "--cap-drop=ALL",
        "--security-opt=no-new-privileges",
        "--user=65534:65534",
        "--cpus=1",
        `--memory=${limits.memoryBytes}`,
        `--memory-swap=${limits.memoryBytes}`,
        `--pids-limit=${limits.maxProcesses}`,
        "--tmpfs=/tmp:rw,noexec,nosuid,size=16777216",
        "--entrypoint=python",
        "quorem-python:local",
        "-B",
        "-c",
        measure,
      ],
      { input, timeout: 15000, maxBuffer: 16384 },
    );
    if (run.status !== 0) throw new Error("Isolated timing run failed");
    const { cpuMs, wallMs, executed } = JSON.parse(run.stdout);
    if (!Number.isFinite(cpuMs) || !Number.isFinite(wallMs) || executed !== true)
      throw new Error("Isolated case did not execute successfully");
    samples.push({ cpuMs, wallMs });
  }
  const delayMs = Math.min(limits.wallTimeMs + 50, 2050);
  console.log(
    JSON.stringify({
      ordinal: row.ordinal,
      publishedLimitMs: row.limits.wallTimeMs,
      effectiveLimitMs: limits.wallTimeMs,
      samples,
      exitDelivery: {
        immediate: await exitDelivery(limits.wallTimeMs, 0),
        delayMs,
        effectiveBudget: await exitDelivery(limits.wallTimeMs, delayMs),
        publishedBudget: await exitDelivery(row.limits.wallTimeMs, delayMs),
      },
    }),
  );
}

await main().catch(() => {
  console.error("Production case timing failed");
  process.exitCode = 1;
});
