/** @file send-previews.ts @description Local-only design fixtures sent through the real mail renderer. @module auth */
import { smtpEmail } from "../adapters/smtp-email.ts";
import { verificationMailer } from "../mailer.ts";
import { accountEmails, type AccountEmailKind } from "./content.ts";

const send = verificationMailer(
  smtpEmail({ host: "127.0.0.1", port: 51025, from: "Quorem <accounts@quorem.local>" }),
  "http://localhost:5300/static",
);
for (const kind of Object.keys(accountEmails) as AccountEmailKind[]) {
  const url = new URL("http://localhost:5180/login");
  url.searchParams.set(kind === "social" ? "socialEmailToken" : "preview", `design-${kind}`);
  await send("design-preview@quorem.test", kind === "sudo" ? "" : url.toString(), {
    ...accountEmails[kind],
    ...(kind === "sudo" ? { code: "482619" } : {}),
  });
  console.log(`Sent ${kind} preview to local Mailpit`);
}
