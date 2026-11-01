import { test } from "node:test";
import { request as httpRequest } from "node:http";
import assert from "node:assert/strict";
import { createServer } from "node:net";
import type { AddressInfo } from "node:net";
import { once } from "node:events";
import { startMailRelay } from "./mail-relay.ts";
import { relayEmail } from "./adapters/relay-email.ts";
import { MailRejected } from "./email-delivery.ts";
import { platformConfiguration } from "./platform-config.ts";
import { configuration } from "./config.ts";
import { createInfrastructure } from "./infrastructure.ts";

void test("SMTP relay preserves accepted, rejected and uncertain outcomes", async () => {
  let outcome: "accepted" | "rejected" | "uncertain" = "accepted",
    sends = 0;
  const smtp = createServer((socket) => {
    socket.write("220 localhost ESMTP\r\n");
    let pending = "",
      data = false;
    socket.on("data", (bytes) => {
      pending += bytes.toString();
      for (;;) {
        if (data) {
          const end = pending.indexOf("\r\n.\r\n");
          if (end < 0) break;
          pending = pending.slice(end + 5);
          data = false;
          sends++;
          if (outcome === "uncertain") {
            socket.destroy();
            return;
          }
          socket.write("250 accepted\r\n");
          continue;
        }
        const end = pending.indexOf("\r\n");
        if (end < 0) break;
        const line = pending.slice(0, end);
        pending = pending.slice(end + 2);
        if (/^EHLO/i.test(line)) socket.write("250 localhost\r\n");
        else if (/^MAIL FROM/i.test(line)) socket.write("250 ok\r\n");
        else if (/^RCPT TO/i.test(line))
          socket.write(outcome === "rejected" ? "550 rejected\r\n" : "250 ok\r\n");
        else if (/^DATA/i.test(line)) {
          data = true;
          socket.write("354 continue\r\n");
        } else if (/^QUIT/i.test(line)) socket.end("221 bye\r\n");
        else socket.write("250 ok\r\n");
      }
    });
  });
  smtp.listen(0, "127.0.0.1");
  await once(smtp, "listening");
  const reservation = createServer();
  reservation.listen(0, "127.0.0.1");
  await once(reservation, "listening");
  const port = (reservation.address() as AddressInfo).port;
  await new Promise<void>((resolve) => reservation.close(() => resolve()));
  const token = "a".repeat(64),
    from = "accounts@example.test";
  const relay = await startMailRelay({
    APP_ENV: "local",
    MAIL_RELAY_LISTEN: `127.0.0.1:${port}`,
    MAIL_RELAY_TOKEN: token,
    AUTH_EMAIL_FROM: from,
    SMTP_HOST: "127.0.0.1",
    SMTP_PORT: String((smtp.address() as AddressInfo).port),
  });
  const origin = `http://127.0.0.1:${port}`,
    mail = relayEmail({ origin, token, from }),
    msg = { to: "user@example.test", subject: "Verify", text: "fixture" };
  try {
    assert.equal((await fetch(`${origin}/health`)).status, 204);
    assert.equal(
      await new Promise<number>((resolve, reject) => {
        const req = httpRequest(
          { hostname: "127.0.0.1", port, path: "http://container/health" },
          (res) => {
            res.resume();
            res.once("end", () => resolve(res.statusCode ?? 0));
          },
        );
        req.once("error", reject);
        req.end();
      }),
      204,
    );
    assert.equal(
      (
        await fetch(`${origin}/internal/mail/send`, {
          method: "POST",
          headers: { authorization: "Bearer wrong" },
        })
      ).status,
      404,
    );
    assert.equal(
      (
        await fetch(`${origin}/internal/mail/send`, {
          method: "POST",
          headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
          body: "x".repeat(65537),
        })
      ).status,
      400,
    );
    await mail.send(msg);
    assert.equal(sends, 1);
    const node = await createInfrastructure(
      configuration({
        APP_ENV: "local",
        AUTH_ORIGIN: "http://localhost:8080",
        AUTH_MODE: "password",
        AUTH_DATABASE_URL: "postgres://localhost/fixture",
        AUTH_INTERNAL_SECRET: "internal-fixture",
        BETTER_AUTH_SECRET: "b".repeat(64),
        AUTH_EMAIL_DRIVER: "relay",
        AUTH_EMAIL_RELAY_ORIGIN: origin,
        AUTH_EMAIL_RELAY_TOKEN: token,
        AUTH_EMAIL_FROM: from,
      }),
    );
    await node.verificationMail!(msg.to, "https://example.test/fixture");
    assert.equal(sends, 2);
    outcome = "rejected";
    await assert.rejects(mail.send(msg), MailRejected);
    assert.equal(sends, 2);
    outcome = "uncertain";
    await assert.rejects(
      mail.send(msg),
      (error: unknown) => error instanceof Error && !(error instanceof MailRejected),
    );
    assert.equal(sends, 3);
    await assert.rejects(
      relayEmail({ origin, token, from }, async () => new Response(null, { status: 422 })).send(
        msg,
      ),
      (error: unknown) => error instanceof Error && !(error instanceof MailRejected),
    );
    assert.throws(() =>
      platformConfiguration({
        APP_ENV: "production",
        AUTH_EMAIL_DRIVER: "relay",
        AUTH_EMAIL_RELAY_ORIGIN: origin,
        AUTH_EMAIL_RELAY_TOKEN: token,
        AUTH_EMAIL_FROM: from,
      }),
    );
  } finally {
    await relay.close();
    await new Promise<void>((resolve) => smtp.close(() => resolve()));
  }
});
