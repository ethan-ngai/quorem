/** Ephemeral provider tails emit only lifecycle messages and redacted runtime exceptions. */
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
export async function tailProductionJudge(keys) {
  const children = [];
  const redact = (raw) => {
    let value = String(raw);
    for (const secret of Object.values(keys))
      if (typeof secret === "string" && secret.length >= 8)
        value = value.replaceAll(secret, "[redacted]");
    return value.replace(/https?:\/\/[^\s]+|postgres(?:ql)?:\/\/[^\s]+/g, "[url]").slice(0, 500);
  };
  await Promise.all(
    ["quorem-hono-services-production", "quorem-hono-production"].map(async (worker) => {
      const child = spawn(
        "vp",
        ["-C", "apps/api", "exec", "wrangler", "tail", worker, "--format", "json"],
        { stdio: ["ignore", "pipe", "pipe"] },
      );
      children.push(child);
      let buffer = "";
      const lines = createInterface({ input: child.stdout });
      let ready;
      const connected = new Promise((resolve) => {
        ready = resolve;
      });
      lines.on("line", (line) => {
        if (!buffer && !line.trim().startsWith("{")) {
          if (/Connected|Successfully/.test(line)) ready();
          return;
        }
        buffer += line + "\n";
        try {
          const event = JSON.parse(buffer);
          buffer = "";
          ready();
          const lifecycle = (event.logs ?? [])
            .flatMap((log) => log.message ?? [])
            .filter(
              (message) =>
                typeof message === "string" &&
                (/^case-lifecycle [a-z-]+$/.test(message) ||
                  /^Case started language=(python|java|typescript|ocaml|postgresql) duration_ms=\d+$/.test(
                    message,
                  )),
            );
          const exceptions = (event.exceptions ?? []).map((error) => ({
            name: redact(error.name),
            message: redact(error.message),
          }));
          if (lifecycle.length || exceptions.length)
            console.log(
              JSON.stringify({
                judgeTail: { worker, lifecycle, exceptions, outcome: event.outcome },
              }),
            );
        } catch {
          if (buffer.length > 1024 * 1024) buffer = "";
        }
      });
      child.stderr.resume();
      child.once("exit", () => ready());
      await Promise.race([connected, new Promise((resolve) => setTimeout(resolve, 10000))]);
    }),
  );
  return async () => {
    for (const child of children) child.kill("SIGTERM");
  };
}
