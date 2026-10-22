import type { EmailDelivery, VerificationSender } from "./email-delivery.ts";

export function verificationMailer(delivery: EmailDelivery): VerificationSender {
  let active = 0;
  return async (to, url, message) => {
    if (active >= 4) throw new Error("Verification mail temporarily busy");
    active++;
    try {
      await delivery.send({
        to,
        subject: message?.subject ?? "Verify your Quorem email",
        text: `${message?.instruction ?? "Verify your email to continue setting up your Quorem account:"}\n\n${url}\n\nThis link expires in one hour. If you did not request it, ignore this email.`,
      });
    } finally {
      active--;
    }
  };
}
