import nodemailer from "nodemailer";
export type MailConfiguration = { host: string; port: number; from: string };
export function verificationMailer(config: MailConfiguration) {
  const transport = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: false,
    connectionTimeout: 5000,
    greetingTimeout: 5000,
    socketTimeout: 5000,
  });
  let active = 0;
  return async (to: string, url: string) => {
    if (active >= 4) throw new Error("Verification mail temporarily busy");
    active++;
    try {
      await transport.sendMail({
        from: config.from,
        to,
        subject: "Verify your Quorem email",
        text: `Verify your email to continue setting up your Quorem account:\n\n${url}\n\nThis link expires in one hour. If you did not request it, ignore this email.`,
      });
    } finally {
      active--;
    }
  };
}
