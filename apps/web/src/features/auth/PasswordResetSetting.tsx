import { useErrorNotification } from "../../ui/Notifications";
import { useState } from "react";
import * as Popover from "../../ui/Popover";
import { Pencil, Mail, Check, LoaderCircle, X } from "lucide-react";
import { Tooltip } from "../editor/components/Tooltip";
import { useCooldown } from "../../ui/useCooldown";
import { AccountRateLimitError, requestPasswordReset } from "./account";
import { authErrorMessage } from "./errors";

/** Email reset stays explicit, with delivery feedback and a persistent resend budget. */
export function PasswordResetSetting({
  email,
  hasPassword = true,
  onOpen,
  disabled = false,
}: {
  email: string;
  hasPassword?: boolean;
  onOpen?: () => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useErrorNotification(error);
  const cooldown = useCooldown();
  async function send() {
    setBusy(true);
    setError("");
    try {
      await requestPasswordReset(email);
      cooldown.start(60);
      setSent(true);
    } catch (cause) {
      if (cause instanceof AccountRateLimitError) cooldown.start(cause.retryAfter);
      setError(authErrorMessage(cause, "Could not send a reset link. Please try again."));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="profile-field">
      <Popover.Root
        open={open}
        onOpenChange={(value) => {
          if (value) onOpen?.();
          setOpen(value);
        }}
      >
        <Popover.Anchor asChild>
          <div className="profile-field-content profile-field-heading">
            <div>
              <span className="profile-field-label">Password</span>
              <p className="profile-field-value">{hasPassword ? "••••••••" : "Not set"}</p>
            </div>
            <Tooltip content={hasPassword ? "Reset password by email" : "Add password by email"}>
              <Popover.Trigger asChild>
                <button className="icon-button" aria-label="Edit password" disabled={disabled}>
                  <Pencil size={16} />
                </button>
              </Popover.Trigger>
            </Tooltip>
          </div>
        </Popover.Anchor>
        <Popover.Portal>
          <Popover.Content
            className="nav-popover settings-reset-popover"
            side="bottom"
            align="end"
            sideOffset={8}
            collisionPadding={8}
            aria-label={hasPassword ? "Reset password" : "Add password"}
          >
            <div className="reset-popover-heading">
              <h3>
                {sent ? "Check your email" : hasPassword ? "Reset your password" : "Add a password"}
              </h3>
              <Popover.Close asChild>
                <button className="icon-button" aria-label="Close password reset">
                  <X size={16} />
                </button>
              </Popover.Close>
            </div>
            <div className="reset-popover-copy" key={sent ? "sent" : "confirm"} aria-live="polite">
              {sent ? (
                <>
                  <p>
                    <Check size={16} /> Reset link sent to <strong>{email}</strong>.
                  </p>
                  <p>Open the link within an hour. Didn’t get it? Check spam, then resend below.</p>
                </>
              ) : (
                <>
                  <p>
                    We’ll send a secure link to <strong>{email}</strong>.
                  </p>
                  <p>
                    {hasPassword
                      ? "Your password stays the same until you use the link."
                      : "Use the link to add a password alongside your social sign-in."}{" "}
                    Completing it signs out all devices.
                  </p>
                </>
              )}
            </div>

            <button
              className="button button-primary"
              disabled={busy || cooldown.remaining > 0}
              aria-busy={busy}
              onClick={() => void send()}
            >
              {busy ? <LoaderCircle className="settings-spinner" size={16} /> : <Mail size={16} />}
              {busy
                ? "Sending…"
                : cooldown.remaining
                  ? `Resend in ${cooldown.remaining}s`
                  : sent
                    ? "Resend reset link"
                    : hasPassword
                      ? "Send reset link"
                      : "Send setup link"}
            </button>
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
    </section>
  );
}
