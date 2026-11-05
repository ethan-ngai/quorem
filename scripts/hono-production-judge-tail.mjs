/** Ephemeral provider tails emit only lifecycle messages and redacted runtime exceptions. */
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
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
        [
          "-C",
          "apps/api",
          "exec",
          "wrangler",
          "tail",
          worker,
          "--format",
          "json",
          "--sampling-rate",
          "1",
        ],
        { stdio: ["ignore", "pipe", "pipe"], detached: true },
      );
      const session = { worker, connected: false, events: 0, stderr: "" };
      children.push({ child, session });
      let buffer = "";
      const lines = createInterface({ input: child.stdout });
      let ready;
      const connected = new Promise((resolve) => {
        ready = resolve;
      });
      lines.on("line", (line) => {
        if (!buffer && !line.trim().startsWith("{")) {
          if (/Connected/.test(line)) session.connected = true;
          if (/Connected|Successfully/.test(line)) ready();
          return;
        }
        buffer += line + "\n";
        try {
          const event = JSON.parse(buffer);
          session.events++;
          session.connected = true;
          buffer = "";
          ready();
          const lifecycle = (event.logs ?? [])
            .flatMap((log) => log.message ?? [])
            .filter(
              (message) =>
                typeof message === "string" &&
                (/^case-lifecycle [a-z0-9-]+$/.test(message) ||
                  /^Case started language=(python|java|typescript|ocaml|postgresql) duration_ms=\d+$/.test(
                    message,
                  )),
            );
          const exceptions = (event.exceptions ?? []).map((error) => ({
            name: redact(error.name),
            fingerprint: createHash("sha256").update(String(error.message)).digest("hex"),
            message: [
              "Too many subrequests.",
              "Too many API requests by single worker invocation.",
              "Too many open connections.",
              "Network connection lost.",
            ].includes(error.message)
              ? error.message
              : "[omitted]",
            connectionLimit: /Too many.*(?:connection|request)/i.test(String(error.message)),
            recursion: /recursive|call.*depth|stack/i.test(String(error.message)),
            ioContext: /I\/O|different request|context/i.test(String(error.message)),
          }));
          if (lifecycle.length || exceptions.length)
            console.log(
              JSON.stringify({
                judgeTail: {
                  worker,
                  lifecycle,
                  exceptions,
                  outcome: event.outcome,
                  status: event.event?.response?.status,
                },
              }),
            );
        } catch {
          if (buffer.length > 1024 * 1024) buffer = "";
        }
      });
      child.stderr.on("data", (data) => {
        if (session.stderr.length < 8192) session.stderr += data.toString();
      });
      child.once("exit", () => ready());
      await Promise.race([connected, new Promise((resolve) => setTimeout(resolve, 10000))]);
    }),
  );
  return async () => {
    // Provider tails deliver the completed request after its response has returned.
    await new Promise((resolve) => setTimeout(resolve, 15000));
    for (const { child, session } of children) {
      console.log(
        JSON.stringify({
          judgeTailSession: {
            worker: session.worker,
            connected: session.connected,
            events: session.events,
            exitCode: child.exitCode,
            permissionError: /unauthorized|forbidden|permission|10000/i.test(session.stderr),
            limitError: /limit|maximum|too many/i.test(session.stderr),
          },
        }),
      );
      try {
        process.kill(-child.pid, "SIGTERM");
      } catch {
        child.kill("SIGTERM");
      }
      child.stdout.destroy();
      child.stderr.destroy();
      child.unref();
    }
  };
}
