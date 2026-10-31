/** @file account-mailer.ts @description Account verification mail gateway. @module auth */
import { APIError } from 'better-auth/api';
import type { VerificationSender } from './email-delivery.ts';
import { MailRateLimited } from './mail-repository.ts';
import { MailRejected, MailUncertain, type MailIntentService } from './mail-intent.ts';

export function accountMailer(mail: MailIntentService) {
  return async (email: string, url: string, subject: string, instruction: string): Promise<void> => {
    try {
      const result = await mail.create('account', { email: email.toLowerCase(), url, subject, instruction });
      if (result === 'rejected') throw new MailRejected('Mail rejected');
      if (result === 'uncertain') throw new MailUncertain('Mail acceptance uncertain');
    } catch (error) {
      if (error instanceof MailRateLimited) throw new APIError('TOO_MANY_REQUESTS', { message: `Try again in ${error.retryAfter} seconds.` }, { 'Retry-After': String(error.retryAfter) });
      throw error;
    }
  };
}

export function accountVerificationSender(mail: MailIntentService): VerificationSender {
  const send = accountMailer(mail);
  return (email, url, message) => send(email, url, message?.subject ?? 'Verify your Quorem email', message?.instruction ?? 'Verify your email to continue setting up your Quorem account:');
}
