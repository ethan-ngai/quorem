/** @file account-email.test.ts @description Content and escaping at the delivery boundary. @module auth */
import { describe, expect, it, vi } from "vitest";
import { verificationMailer } from "../mailer.ts";
import { accountEmails, type AccountEmailKind } from "./content.ts";
import { MailRejected, type EmailMessage } from "../email-delivery.ts";

describe("account email rendering", () => {
  it.each(Object.keys(accountEmails) as AccountEmailKind[])(
    "delivers %s in HTML and plain text",
    async (kind) => {
      let message: EmailMessage | undefined;
      const url =
        kind === "sudo"
          ? ""
          : `https://quorem.example/login?${kind === "social" ? "socialEmailToken" : "token"}=fixture&returnTo=%2Fpractice`;
      await verificationMailer({
        send: async (value) => {
          message = value;
        },
      })("reader@example.test", url, {
        ...accountEmails[kind],
        ...(kind === "sudo" ? { code: "482619" } : {}),
      });
      expect(message?.subject).toBe(accountEmails[kind].subject);
      expect(message?.html).toContain(accountEmails[kind].title);
      expect(message?.html).toContain('lang="en"');
      expect(message?.html).toContain("prefers-color-scheme: dark");
      expect(message?.text).toContain(kind === "sudo" ? "482619" : url);
      expect(message?.text).toContain(
        kind === "sudo" ? "expires in 5 minutes" : "expires in one hour",
      );
      expect(message?.html).toContain("quorem-lockup.png");
      expect(message?.html).toContain("mailto:contact@quorem.app");
      if (kind === "sudo") {
        expect(message?.html).not.toContain('href="482619"');
        expect(message?.text).not.toContain("one hour");
      }
      expect(message?.text).not.toMatch(/<\/?(?:html|table|a)[ >]/);
    },
  );

  it("rejects missing or malformed code metadata before provider delivery", async () => {
    const send = vi.fn();
    const deliver = verificationMailer({ send });
    for (const code of [undefined, "12345", "12<456", "1234567"]) {
      await expect(
        deliver("reader@example.test", "", { ...accountEmails.sudo, code }),
      ).rejects.toBeInstanceOf(MailRejected);
    }
    expect(send).not.toHaveBeenCalled();
  });

  it("escapes instructions and renders registration without metadata", async () => {
    const sent: EmailMessage[] = [];
    const send = verificationMailer({
      send: async (value) => {
        sent.push(value);
      },
    });
    await send("reader@example.test", "https://quorem.example/login?signupToken=fixture");
    await send("reader@example.test", "https://quorem.example/verify", {
      subject: "Verify",
      instruction: '<script>alert("x")</script>',
    });
    expect(sent[0].html).toContain(accountEmails.registration.title);
    expect(sent[1].html).not.toContain("<script>");
    expect(sent[1].html).toContain("&lt;script&gt;");
  });
});
