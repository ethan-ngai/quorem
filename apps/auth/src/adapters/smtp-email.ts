import nodemailer from "nodemailer";
import type { EmailDelivery } from "../email-delivery.ts";
export type SMTPConfiguration = {
  host: string;
  port: number;
  from: string;
  secure?: boolean;
  requireTLS?: boolean;
  auth?: { user: string; pass: string };
};
export function smtpEmail(config: SMTPConfiguration): EmailDelivery & { verify(): Promise<void> } {
  const { from, ...connection } = config;
  const transport = nodemailer.createTransport({
    ...connection,
    secure: config.secure ?? false,
    connectionTimeout: 5000,
    greetingTimeout: 5000,
    socketTimeout: 5000,
  });
  return {
    async verify() {
      try {
        await transport.verify();
      } catch {
        throw new Error("Email delivery unavailable");
      }
    },
    async send(message) {
      try {
        await transport.sendMail({ from, ...message });
      } catch {
        throw new Error("Email delivery unavailable");
      }
    },
  };
}
