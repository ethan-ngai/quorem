import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const kind = process.env.QUOREM_PRIVATE_SERVICE;
const keyName =
  kind === "runner"
    ? "QUOREM_CASE_OWNER_PUBLIC_KEY_PEM"
    : kind === "verifier"
      ? "QUOREM_VERIFICATION_SIGNING_KEY_PEM"
      : "";
const pathName =
  kind === "runner" ? "QUOREM_CASE_OWNER_PUBLIC_KEY_FILE" : "QUOREM_VERIFICATION_SIGNING_KEY_FILE";
let directory;
try {
  if (!keyName || !process.env[keyName]) throw new Error("Missing service key");
  directory = await mkdtemp(join(tmpdir(), "quorem-private-"));
  const path = join(directory, "key.pem");
  await writeFile(path, process.env[keyName], { mode: 0o600, flag: "wx" });
  delete process.env[keyName];
  process.env[pathName] = path;
  const service =
    kind === "runner"
      ? await (await import("../../../apps/runner/src/runtime/runner.ts")).startRunner(process.env)
      : await (
          await import("../../../apps/runner/src/runtime/verifier.ts")
        ).startVerifier(process.env);
  let closing = false;
  const stop = () => {
    if (closing) return;
    closing = true;
    void service
      .close()
      .catch(() => {
        process.exitCode = 1;
      })
      .finally(() => rm(directory, { recursive: true, force: true }));
  };
  process.once("SIGTERM", stop);
  process.once("SIGINT", stop);
} catch {
  if (directory) await rm(directory, { recursive: true, force: true });
  console.error("Private service startup failed");
  process.exitCode = 1;
}
