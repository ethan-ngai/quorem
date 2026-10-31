/** @file email-delivery.ts @description Mail acceptance contract. @module auth */
/** Provider definitively rejected before acceptance. */
export class MailRejected extends Error {}
export type EmailMessage = { to: string; subject: string; text: string };
/** Resolves on provider acceptance, never a guarantee of inbox delivery. */
export interface EmailDelivery {
  send(message: EmailMessage): Promise<void>;
}
export type VerificationSender = (
  to: string,
  url: string,
  message?: { subject: string; instruction: string },
) => Promise<void>;
