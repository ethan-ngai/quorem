import { createElement } from "react";
import { render, toPlainText } from "react-email";
import { AccountEmail } from "./emails/account-email.ts";
import { accountEmailKind, accountEmails } from "./emails/content.ts";
import { MailRejected, type EmailDelivery, type VerificationSender } from "./email-delivery.ts";

export function verificationMailer(
  delivery: EmailDelivery,
  assetBaseURL?: string,
): VerificationSender {
  let active = 0;
  return async (to, url, message) => {
    if (active >= 4) throw new Error("Verification mail temporarily busy");
    active++;
    try {
      const kind = accountEmailKind(url, message?.subject);
      if (kind === "sudo" && !/^\d{6}$/.test(message?.code ?? ""))
        throw new MailRejected("Invalid verification code");
      const html = await render(
        createElement(AccountEmail, {
          kind,
          url,
          code: message?.code,
          instruction: message?.instruction,
          assetBaseURL,
        }),
      );
      await delivery.send({
        to,
        subject: message?.subject ?? accountEmails[kind].subject,
        text: toPlainText(html),
        html,
      });
    } finally {
      active--;
    }
  };
}
