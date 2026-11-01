import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";

const name = `quorem-36b-${randomUUID()}`;
const volume = `${name}-fence`;
const postgres = `${name}-postgres`;
const docker = (...args) => execFileSync("docker", args, { stdio: "inherit" });
const output = (...args) => execFileSync("docker", args, { encoding: "utf8" }).trim();
try {
  docker("info", "--format", "{{.ID}}");
  docker("image", "inspect", "quorem-python:local");
  docker(
    "build",
    "-f",
    "deploy/hono/Dockerfile.runner",
    "--target",
    "runner",
    "-t",
    "quorem-hono-runner:36b",
    ".",
  );
  docker(
    "build",
    "-f",
    "deploy/hono/Dockerfile.runner",
    "--target",
    "verifier",
    "-t",
    "quorem-hono-verifier:36b",
    ".",
  );
  docker("build", "-f", "deploy/hono/fixtures/Dockerfile", "-t", "quorem-hono-fixture:36b", ".");
  docker("volume", "create", volume);
  docker(
    "run",
    "--rm",
    "--user",
    "0",
    "--mount",
    `type=volume,source=${volume},destination=/quorem-36b`,
    "--entrypoint",
    "sh",
    "quorem-hono-fixture:36b",
    "-c",
    "chown 1000:1000 /quorem-36b && chmod 700 /quorem-36b",
  );
  const gid = output(
    "run",
    "--rm",
    "--mount",
    "type=bind,source=/var/run/docker.sock,destination=/var/run/docker.sock",
    "--entrypoint",
    "stat",
    "quorem-hono-fixture:36b",
    "-c",
    "%g",
    "/var/run/docker.sock",
  );
  docker(
    "run",
    "-d",
    "--name",
    name,
    "--group-add",
    gid,
    "--mount",
    "type=bind,source=/var/run/docker.sock,destination=/var/run/docker.sock",
    "--mount",
    `type=volume,source=${volume},destination=/quorem-36b`,
    "-e",
    "TMPDIR=/quorem-36b",
    "quorem-hono-fixture:36b",
  );
  docker(
    "run",
    "-d",
    "--name",
    postgres,
    "--network",
    `container:${name}`,
    "-e",
    "POSTGRES_USER=fixture",
    "-e",
    "POSTGRES_PASSWORD=fixture",
    "-e",
    "POSTGRES_DB=quorem_hono_engine_test",
    "postgres:17.6-alpine",
  );
  let ready = false;
  for (let i = 0; i < 120; i++) {
    try {
      execFileSync("docker", ["exec", postgres, "pg_isready", "-U", "fixture"], {
        stdio: "ignore",
      });
      ready = true;
      break;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  if (!ready) throw new Error("Disposable PostgreSQL did not become ready");
  const result = output(
    "exec",
    "-e",
    "NO_COLOR=1",
    "-e",
    "QUOREM_CONTAINER_FIXTURE=1",
    "-e",
    `QUOREM_CONTAINER_FENCE_VOLUME=${volume}`,
    "-e",
    `QUOREM_CONTAINER_SOCKET_GID=${gid}`,
    "-e",
    "QUOREM_ENGINE_TEST_DATABASE_URL=postgres://fixture:fixture@127.0.0.1:5432/quorem_hono_engine_test",
    "-e",
    "QUOREM_TEST_DOCKER_SOCKET=/var/run/docker.sock",
    name,
    "vp",
    "-C",
    "apps/api",
    "exec",
    "vitest",
    "run",
    "--config",
    "src/adapters/postgres/judging/admission/vitest.runner.config.ts",
    "-t",
    "runs an admitted job through separate runner and verifier executables",
  );
  process.stdout.write(`${result}\n`);
  if (
    !result.includes("1 passed") ||
    !result.includes("runs an admitted job through separate runner and verifier executables")
  )
    throw new Error("Required container test did not pass");
} finally {
  for (const id of [postgres, name])
    try {
      execFileSync("docker", ["rm", "-f", id], { stdio: "ignore" });
    } catch {}
  try {
    execFileSync("docker", ["volume", "rm", volume], { stdio: "ignore" });
  } catch {}
}
