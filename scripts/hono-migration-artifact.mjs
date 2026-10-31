/** Read-only production workflow and immutable migration artifact provenance. */
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";

const owner = "ethan-ngai",
  repository = "quorem",
  workflow = ".github/workflows/deploy.yaml";
const root = `repos/${owner}/${repository}`,
  maxResponse = 8 * 1024 * 1024,
  maxFile = 1024 * 1024,
  maxTotal = 32 * 1024 * 1024;
// Reviewed production migration owner bytes; changes require a fresh provenance review.
const reviewedSources = {
  ".github/workflows/deploy.yaml": [
    "acc10f1c5432b150b048708265652926d77aa74accd108388b513d81d0b9011b",
  ],
  "apps/api/cmd/provision/main.go": [
    "e0d2448038b672f2624bc9e099002fef5faed270445405517e3c40ec4abc9f90",
  ],
  "apps/api/internal/adapters/postgres/store.go": [
    "d9e79f44df188858424423a2921275ce98209d79cb368d4b2c77dae7ed8e6639",
  ],
  "apps/auth/src/migrations.ts": [
    "28d88267a4565a64fb06bab07ba4f4c8dc7baee4b66551bbab8517de70dda60c",
  ],
  "apps/auth/src/migrate.ts": [
    "31b4f253606fc6a76914c95795effb995742d02c84a49904aa19dfc633b1078a",
    "90ff7b88c4d9cdcdff389c2d0e3d46209b999add481c4bab08f2cb05805b5725",
  ],
  "apps/auth/package.json": [
    "d2a21ace79ece504de62d3ad9e0e3b9d23b847bbaa59caebc36002211e3b306c",
    "6eee2eadad2b03fb793ac670af3ce2e65b868f63025d3c79826117222b939490",
  ],
};
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const fail = () => {
  throw new Error("Migration artifact verification failed");
};

/** Authenticated GitHub API transport; stderr and raw provider errors never escape. */
export async function githubRequest(path) {
  if (typeof path !== "string" || !path.startsWith(`${root}/`) || /[\r\n]/.test(path)) fail();
  return await new Promise((resolve, reject) => {
    const child = spawn(
      "gh",
      [
        "api",
        "--hostname",
        "github.com",
        "--method",
        "GET",
        path,
        "--header",
        "Accept: application/vnd.github+json",
      ],
      { stdio: ["ignore", "pipe", "ignore"] },
    );
    const chunks = [];
    let size = 0,
      failed = false;
    const timer = setTimeout(() => {
      failed = true;
      child.kill("SIGKILL");
    }, 30000);
    child.stdout.on("data", (chunk) => {
      size += chunk.length;
      if (size > maxResponse) {
        failed = true;
        child.kill("SIGKILL");
      } else chunks.push(chunk);
    });
    child.once("error", () => {
      clearTimeout(timer);
      reject(new Error("GitHub verification unavailable"));
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      if (failed || code !== 0) return reject(new Error("GitHub verification unavailable"));
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch {
        reject(new Error("GitHub verification unavailable"));
      }
    });
  });
}

function checked(value) {
  if (!value || typeof value !== "object" || Buffer.byteLength(JSON.stringify(value)) > maxResponse)
    fail();
  return value;
}
function migrationNames(names) {
  if (
    !Array.isArray(names) ||
    names.length > 256 ||
    names.some((name) => typeof name !== "string" || !/^[0-9]{3}_[a-z0-9_]+\.sql$/.test(name)) ||
    new Set(names).size !== names.length
  )
    fail();
  return [...names].sort((a, b) => a.localeCompare(b));
}
function verifyWorkflow(source) {
  const match = source.match(/^  deploy:\s*\n([\s\S]*?)(?=^  [a-zA-Z0-9_-]+:\s*\n|$(?![\s\S]))/m);
  if (!match) fail();
  const job = match[1];
  const checkout = [
    ...job.matchAll(
      /^      - uses: actions\/checkout@([0-9a-f]{40})(?:\s*#.*)?\s*\n(?:        with:\s*\n((?:          [^\n]*\n)*))?/gm,
    ),
  ];
  if (
    checkout.length !== 1 ||
    checkout[0][1] !== "d23441a48e516b6c34aea4fa41551a30e30af803" ||
    /(?:^|\n)\s*(?:ref|repository|path):/.test(checkout[0][2] ?? "") ||
    /^\s*(?:defaults|working-directory):/m.test(job)
  )
    fail();
  const step = job.match(
    /^      - name: Migrate and bootstrap operator\s*\n([\s\S]*?)(?=^      - |$(?![\s\S]))/m,
  );
  if (
    !step ||
    checkout[0].index >= step.index ||
    !/^        if: github\.ref == 'refs\/heads\/main'\s*$/m.test(step[1])
  )
    fail();
  const run = step[1].match(/^        run: \|\s*\n((?:          [^\n]*\n|\n)*)/m)?.[1];
  if (
    !run ||
    !/^          go build -o \.local\/deploy\/provision \.\/apps\/api\/cmd\/provision$/m.test(
      run,
    ) ||
    !/^          \.local\/deploy\/provision$/m.test(run) ||
    !/^          vp -C apps\/auth run migrate$/m.test(run)
  )
    fail();
  if (
    /^\s*(?:git\s+(?:checkout|switch|reset|pull)|(?:cp|mv|rm)\s+.*migrations)/m.test(
      job.slice(0, step.index),
    )
  )
    fail();
}

/** Proves selected repository bytes and successful workflow steps, not database state or runner integrity. */
export async function verifyMigrationArtifact({
  runId,
  productNames,
  authNames,
  request = githubRequest,
}) {
  if (
    typeof runId !== "string" ||
    !/^[1-9][0-9]{0,19}$/.test(runId) ||
    typeof request !== "function"
  )
    fail();
  const product = migrationNames(productNames),
    auth = migrationNames(authNames);
  if (product.length + auth.length === 0) fail();
  const get = async (path) => {
    try {
      return checked(await request(path));
    } catch {
      return fail();
    }
  };
  const run = await get(`${root}/actions/runs/${runId}`);
  if (
    String(run.id) !== runId ||
    run.path !== workflow ||
    run.name !== "Deploy production" ||
    run.status !== "completed" ||
    run.conclusion !== "success" ||
    run.head_branch !== "main" ||
    !["push", "workflow_dispatch"].includes(run.event) ||
    run.repository?.full_name !== `${owner}/${repository}` ||
    run.head_repository?.full_name !== `${owner}/${repository}` ||
    !/^[0-9a-f]{40}$/.test(run.head_sha) ||
    !Number.isSafeInteger(run.run_attempt) ||
    run.run_attempt < 1 ||
    run.run_attempt > 100
  )
    fail();
  const jobs = [];
  for (let page = 1; page <= 10; page++) {
    const result = await get(
      `${root}/actions/runs/${runId}/attempts/${run.run_attempt}/jobs?per_page=100&page=${page}`,
    );
    if (
      !Array.isArray(result.jobs) ||
      result.jobs.length > 100 ||
      !Number.isSafeInteger(result.total_count) ||
      result.total_count > 1000
    )
      fail();
    jobs.push(...result.jobs);
    if (jobs.length >= result.total_count) {
      if (jobs.length !== result.total_count) fail();
      break;
    }
    if (result.jobs.length !== 100 || page === 10) fail();
  }
  const deploy = jobs.filter((job) => job.name === "deploy");
  if (
    deploy.length !== 1 ||
    deploy[0].status !== "completed" ||
    deploy[0].conclusion !== "success" ||
    String(deploy[0].run_id) !== runId ||
    !Array.isArray(deploy[0].steps)
  )
    fail();
  const steps = deploy[0].steps,
    migration = steps.filter((step) => step.name === "Migrate and bootstrap operator"),
    checkout = steps.filter(
      (step) => typeof step.name === "string" && step.name.startsWith("Run actions/checkout@"),
    );
  if (
    migration.length !== 1 ||
    checkout.length !== 1 ||
    migration[0].status !== "completed" ||
    migration[0].conclusion !== "success" ||
    checkout[0].status !== "completed" ||
    checkout[0].conclusion !== "success" ||
    !Number.isInteger(migration[0].number) ||
    !Number.isInteger(checkout[0].number) ||
    checkout[0].number >= migration[0].number
  )
    fail();
  const commit = run.head_sha;
  let total = 0;
  const content = async (path) => {
    const item = await get(`${root}/contents/${path}?ref=${commit}`);
    if (
      item.type !== "file" ||
      item.path !== path ||
      item.encoding !== "base64" ||
      typeof item.content !== "string" ||
      !Number.isSafeInteger(item.size) ||
      item.size < 0 ||
      item.size > maxFile ||
      !/^[0-9a-f]{40}$/.test(item.sha)
    )
      fail();
    const encoded = item.content.replace(/\n/g, "");
    if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)) fail();
    const bytes = Buffer.from(encoded, "base64");
    if (
      bytes.length !== item.size ||
      createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex") !== item.sha
    )
      fail();
    total += bytes.length;
    if (total > maxTotal) fail();
    return bytes;
  };
  const sources = {};
  for (const [path, hashes] of Object.entries(reviewedSources)) {
    const bytes = await content(path);
    if (!hashes.includes(sha256(bytes))) fail();
    sources[path] = bytes.toString("utf8");
  }
  verifyWorkflow(sources[workflow]);
  let authPackage;
  try {
    authPackage = JSON.parse(sources["apps/auth/package.json"]);
  } catch {
    fail();
  }
  if (
    !sources["apps/api/cmd/provision/main.go"].includes(
      'store.Migrate(ctx, "apps/api/migrations")',
    ) ||
    !sources["apps/api/internal/adapters/postgres/store.go"].includes(
      'filepath.Glob(filepath.Join(dir, "*.sql"))',
    ) ||
    !sources["apps/auth/src/migrations.ts"].includes(
      'new URL("../migrations/", import.meta.url)',
    ) ||
    !sources["apps/auth/src/migrate.ts"].includes("await migrateAuth(database)") ||
    authPackage.scripts?.migrate !==
      "node --env-file-if-exists=.env --experimental-strip-types src/migrate.ts"
  )
    fail();
  const files = {};
  const paths = [
    ...product.map((name) => `apps/api/migrations/${name}`),
    ...auth.map((name) => `apps/auth/migrations/${name}`),
  ];
  for (const path of paths) files[path] = sha256(await content(path));
  const artifactDigest = sha256(
    Buffer.from(
      JSON.stringify([
        "quorem-migration-artifact-v1",
        owner,
        repository,
        workflow,
        runId,
        commit,
        Object.entries(files),
      ]),
    ),
  );
  return { owner, repository, workflow, runId, commitSha: commit, artifactDigest, files };
}
