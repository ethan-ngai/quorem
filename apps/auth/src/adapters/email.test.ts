import { describe, expect, it, vi } from "vitest";
const { sendMail, createTransport } = vi.hoisted(() => ({
  sendMail: vi.fn(),
  createTransport: vi.fn(),
}));
vi.mock("nodemailer", () => ({ default: { createTransport } }));
import { smtpEmail } from "./smtp-email";
import { cloudflareEmail } from "./cloudflare-email";
import { verificationMailer } from "../mailer";
import { MailRejected } from "../email-delivery.ts";
const message = { to: "person@example.com", subject: "Verify", text: "A link" };
describe("email adapters", () => {
  it("verifies SMTP authentication without sending a message or exposing provider failures", async () => {
    const verify = vi.fn().mockResolvedValue(true);
    const send = vi.fn();
    createTransport.mockReturnValue({ verify, sendMail: send });
    const mail = smtpEmail({
      host: "smtp.purelymail.com",
      port: 465,
      secure: true,
      requireTLS: true,
      from: "accounts@example.com",
    });
    await mail.verify();
    expect(verify).toHaveBeenCalledOnce();
    expect(send).not.toHaveBeenCalled();
    verify.mockRejectedValueOnce(new Error("private SMTP credentials"));
    await expect(mail.verify()).rejects.toThrow("Email delivery unavailable");
  });
  it("maps SMTP acceptance and secure SES credentials without SDK-specific account logic", async () => {
    createTransport.mockReturnValue({ sendMail });
    sendMail.mockResolvedValue({});
    const config = {
      host: "email-smtp.us-east-1.amazonaws.com",
      port: 465,
      secure: true,
      requireTLS: true,
      from: "accounts@example.com",
      auth: { user: "smtp-user", pass: "smtp-secret" },
    };
    await smtpEmail(config).send(message);
    expect(createTransport).toHaveBeenLastCalledWith({
      host: config.host,
      port: 465,
      secure: true,
      requireTLS: true,
      auth: config.auth,
      connectionTimeout: 5000,
      greetingTimeout: 5000,
      socketTimeout: 5000,
    });
    expect(sendMail).toHaveBeenLastCalledWith({ from: config.from, ...message });
    sendMail.mockRejectedValueOnce(new Error("provider credentials details"));
    await expect(smtpEmail(config).send(message)).rejects.toThrow("Email delivery unavailable");
  });
  it("distinguishes SMTP rejection from ambiguous connection loss", async () => {
    createTransport.mockReturnValue({ sendMail });
    const mail = smtpEmail({ host: "localhost", port: 25, from: "accounts@example.com" });
    sendMail.mockRejectedValueOnce(
      Object.assign(new Error("private SMTP response"), { responseCode: 550 }),
    );
    await expect(mail.send(message)).rejects.toBeInstanceOf(MailRejected);
    sendMail.mockRejectedValueOnce(
      Object.assign(new Error("private socket error"), { code: "ECONNRESET" }),
    );
    await expect(mail.send(message)).rejects.toThrow("Email delivery unavailable");
  });
  it.each(["delivered", "queued"])(
    "maps Cloudflare outbound REST %s acceptance",
    async (status) => {
      const request = vi
        .fn()
        .mockResolvedValue(Response.json({ success: true, result: { [status]: [message.to] } }));
      await cloudflareEmail(
        { accountId: "a".repeat(32), apiToken: "secret", from: "accounts@example.com" },
        request,
      ).send(message);
      expect(request).toHaveBeenCalledOnce();
      const [url, options] = request.mock.calls[0];
      expect(url).toBe(
        `https://api.cloudflare.com/client/v4/accounts/${"a".repeat(32)}/email/sending/send`,
      );
      expect(options.method).toBe("POST");
      expect(options.redirect).toBe("manual");
      expect(options.headers.Authorization).toBe("Bearer secret");
      expect(JSON.parse(options.body)).toEqual({ from: "accounts@example.com", ...message });
      expect(options.signal).toBeInstanceOf(AbortSignal);
    },
  );
  it.each([
    new Response("secret provider text", { status: 429 }),
    Response.json({ success: false }),
    Response.json({ success: "true", result: { delivered: [message.to] } }),
    Response.json({ success: true, result: { delivered: message.to } }),
    Response.json({
      success: true,
      result: { permanent_bounces: [message.to], delivered: [message.to] },
    }),
    Response.json({ success: true, result: { queued: ["other@example.com"] } }),
    new Response("invalid json"),
  ])(
    "rejects provider failures, bounces and malformed acceptance without leaking details or retrying",
    async (response) => {
      const request = vi.fn().mockResolvedValue(response);
      await expect(
        cloudflareEmail(
          { accountId: "a".repeat(32), apiToken: "secret", from: "accounts@example.com" },
          request,
        ).send(message),
      ).rejects.toThrow("Email delivery unavailable");
      expect(request).toHaveBeenCalledOnce();
    },
  );
  it("does not follow redirects carrying credentials or verification links", async () => {
    const { createServer } = await import("node:http");
    let forwarded = false;
    const server = createServer((req, res) => {
      if (req.url === "/redirect") res.writeHead(307, { Location: "/capture" }).end();
      else {
        forwarded = true;
        res.end("captured");
      }
    });
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address() as { port: number };
    const request = vi.fn((_url: string | URL | Request, options?: RequestInit) =>
      fetch(`http://127.0.0.1:${address.port}/redirect`, options),
    );
    try {
      await expect(
        cloudflareEmail(
          { accountId: "a".repeat(32), apiToken: "secret", from: "accounts@example.com" },
          request,
        ).send({ ...message, text: "https://quorem.example/login?signupToken=secret" }),
      ).rejects.toThrow("Email delivery unavailable");
      expect(forwarded).toBe(false);
      expect(request).toHaveBeenCalledOnce();
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });
  it.each([true, false])(
    "cancels oversized provider responses with content-length=%s",
    async (declared) => {
      const cancel = vi.fn();
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new Uint8Array(65537));
        },
        cancel,
      });
      const request = vi
        .fn()
        .mockResolvedValue(
          new Response(body, { headers: declared ? { "Content-Length": "65537" } : {} }),
        );
      await expect(
        cloudflareEmail(
          { accountId: "a".repeat(32), apiToken: "secret", from: "accounts@example.com" },
          request,
        ).send(message),
      ).rejects.toThrow("Email delivery unavailable");
      expect(cancel).toHaveBeenCalledOnce();
      expect(request).toHaveBeenCalledOnce();
    },
  );
  it("bounds shared verification delivery concurrency and releases capacity on failure", async () => {
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    const send = vi.fn().mockReturnValue(pending);
    const deliver = verificationMailer({ send });
    const jobs = Array.from({ length: 4 }, () =>
      deliver(message.to, "https://quorem.example/login?token=opaque"),
    );
    await expect(deliver(message.to, "unused")).rejects.toThrow("temporarily busy");
    release();
    await Promise.all(jobs);
    send.mockRejectedValueOnce(new Error("delivery failed"));
    await expect(deliver(message.to, "retry")).rejects.toThrow("delivery failed");
    await deliver(message.to, "next", {
      subject: "Reset password",
      instruction: "Choose a password:",
    });
    expect(send).toHaveBeenLastCalledWith({
      to: message.to,
      subject: "Reset password",
      text: expect.stringContaining("Choose a password:\n\nnext"),
    });
  });
});
