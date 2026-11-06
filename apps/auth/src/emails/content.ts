/** @file content.ts @description Shared account email copy. @module auth */
export const accountEmails = {
  sudo: {
    subject: "Confirm sudo mode",
    title: "Confirm it’s you.",
    instruction: "Enter this code in Quorem to confirm your identity.",
    action: "",
    detail:
      "This code expires in 5 minutes. Never share it with anyone. Quorem will never ask you to send a sign-in code by email.",
  },
  registration: {
    subject: "Verify your Quorem email",
    title: "Verify your email",
    instruction: "Verify your email to continue setting up your Quorem account.",
    action: "Verify email",
    detail:
      "After verification, choose your username and password to finish creating your account.",
  },
  reset: {
    subject: "Reset your Quorem password",
    title: "Reset your password",
    instruction: "Choose a new password for your Quorem account.",
    action: "Reset password",
    detail: "Completing the reset signs out all sessions.",
  },
  change: {
    subject: "Confirm your Quorem email change",
    title: "Confirm your email change",
    instruction: "Confirm that you requested to change your Quorem email address.",
    action: "Confirm email change",
    detail:
      "Next, we’ll send a verification link to your new address. Your current address stays unchanged until both steps finish.",
  },
  verify: {
    subject: "Verify your new Quorem email",
    title: "Verify your new email",
    instruction: "Verify your new email address to finish updating your Quorem account.",
    action: "Verify new email",
    detail: "Once verified, use this address to sign in and recover your account.",
  },
  social: {
    subject: "Verify your Quorem email",
    title: "Verify your email",
    instruction: "Verify this email address to continue connecting your sign-in provider.",
    action: "Verify email",
    detail:
      "Open this link in the browser where you started. Then continue with your provider to finish.",
  },
} as const;
export type AccountEmailKind = keyof typeof accountEmails;

/** @returns Presentation only; token verification stays with the owning auth flow. */
export function accountEmailKind(url: string, subject?: string): AccountEmailKind {
  if (subject === accountEmails.sudo.subject) return "sudo";
  if (new URL(url).searchParams.has("socialEmailToken")) return "social";
  return (
    (["reset", "change", "verify"] as const).find(
      (kind) => accountEmails[kind].subject === subject,
    ) ?? "registration"
  );
}
