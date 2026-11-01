import { createServer } from "node:http";
import { normalizeHttpTarget } from "@quorem/execution/transport/http-target";
import { timingSafeEqual } from "node:crypto";
import { once } from "node:events";
import { smtpEmail } from "./adapters/smtp-email.ts";
import { MailRejected, type EmailDelivery, type EmailMessage } from "./email-delivery.ts";
import { platformConfiguration } from "./platform-config.ts";

const maxBody = 65536;
function message(value: unknown, from: string): EmailMessage {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
  const row = value as Record<string, unknown>;
  if (
    Object.keys(row).sort().join() !== "from,subject,text,to" ||
    row.from !== from ||
    typeof row.to !== "string" ||
    row.to.length < 3 ||
    row.to.length > 320 ||
    /[\r\n]/.test(row.to) ||
    typeof row.subject !== "string" ||
    row.subject.length < 1 ||
    row.subject.length > 512 ||
    /[\r\n]/.test(row.subject) ||
    typeof row.text !== "string" ||
    row.text.length < 1 ||
    row.text.length > 60000
  )
    throw new Error();
  return { to: row.to, subject: row.subject, text: row.text };
}

/** SMTP credentials remain confined to this process; no ambiguous delivery is retried. */
export async function startMailRelay(env: NodeJS.ProcessEnv, delivery?: EmailDelivery) {
  const address = /^(127\.0\.0\.1|localhost|0\.0\.0\.0):([1-9]\d{0,4})$/.exec(
    env.MAIL_RELAY_LISTEN ?? "",
  );
  const token = env.MAIL_RELAY_TOKEN ?? "",
    from = env.AUTH_EMAIL_FROM ?? "";
  if (
    !address ||
    Number(address[2]) > 65535 ||
    new TextEncoder().encode(token).length < 32 ||
    /\s/.test(token) ||
    !from ||
    /[\r\n]/.test(from)
  )
    throw new Error("Invalid mail relay configuration");
  const smtp =
    delivery ??
    (() => {
      const config = platformConfiguration({ ...env, AUTH_EMAIL_DRIVER: "smtp" }).mail;
      if (!config || config.driver !== "smtp") throw new Error("SMTP configuration required");
      return smtpEmail(config);
    })();
  if (!delivery && "verify" in smtp && typeof smtp.verify === "function") await smtp.verify();
  const expected = Buffer.from(`Bearer ${token}`),
    active = new Set<Promise<void>>();
  let closing = false;
  const server = createServer((req, res) => {
    const task = (async () => {
      const target = normalizeHttpTarget(req.url);
      if (!target) {
        res.writeHead(400).end();
        return;
      }
      if (closing) {
        res.writeHead(503).end();
        return;
      }
      if (req.method === "GET" && target === "/health") {
        res.writeHead(204).end();
        return;
      }
      const supplied = Buffer.from(req.headers.authorization ?? "");
      if (
        req.method !== "POST" ||
        target !== "/internal/mail/send" ||
        supplied.length !== expected.length ||
        !timingSafeEqual(supplied, expected)
      ) {
        res.writeHead(404).end();
        return;
      }
      if (
        req.headers["content-type"] !== "application/json" ||
        Number(req.headers["content-length"] ?? 0) > maxBody
      ) {
        res.writeHead(400).end();
        return;
      }
      let parsed: EmailMessage;
      try {
        const chunks: Buffer[] = [];
        let size = 0;
        for await (const chunk of req) {
          const bytes = Buffer.from(chunk);
          size += bytes.length;
          if (size > maxBody) {
            res.writeHead(413).end();
            req.destroy();
            return;
          }
          chunks.push(bytes);
        }
        parsed = message(
          JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks))),
          from,
        );
      } catch {
        if (!res.destroyed) res.writeHead(400).end();
        return;
      }
      try {
        await smtp.send(parsed);
        if (!res.destroyed) res.writeHead(204).end();
      } catch (error) {
        if (!res.destroyed) {
          if (error instanceof MailRejected)
            res.writeHead(422, { "x-quorem-mail-result": "rejected" }).end();
          else res.writeHead(503).end();
        }
      }
    })().catch(() => {
      if (!res.headersSent && !res.destroyed) res.writeHead(503).end();
    });
    active.add(task);
    void task.finally(() => active.delete(task));
  });
  server.requestTimeout = 10000;
  server.headersTimeout = 5000;
  server.listen(Number(address[2]), address[1]);
  await once(server, "listening");
  return {
    async close() {
      closing = true;
      const done = new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
      server.closeIdleConnections();
      await Promise.all(active);
      await done;
    },
  };
}

if (import.meta.main) {
  try {
    const relay = await startMailRelay(process.env);
    for (const signal of ["SIGINT", "SIGTERM"] as const)
      process.once(signal, () => {
        void relay.close().catch(() => {
          process.exitCode = 1;
        });
      });
  } catch {
    console.error("Mail relay unavailable");
    process.exitCode = 1;
  }
}
