import { toast } from "sonner";
import { authErrorMessage } from "./errors";
import { useEffect, useState, type FormEvent } from "react";
import { ArrowLeft, Eye, EyeOff } from "lucide-react";
import { emailInputSchema, emailSchema, passwordSchema } from "@quorem/contracts/auth";
import { Brand } from "../editor/components/Icon";
import { LoginShowcase } from "./LoginShowcase";
import { useTheme } from "../editor/useTheme";
import { resetToken } from "./session";
import { useCooldown } from "../../ui/useCooldown";
import { AccountRateLimitError, requestPasswordReset, finishPasswordReset } from "./account";
import "./auth.css";

export function PasswordReset() {
  useTheme();
  const [token] = useState(() => new URLSearchParams(location.search).get("token") ?? "");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [visible, setVisible] = useState(false);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    const url = new URL(location.href);
    url.searchParams.delete("token");
    history.replaceState(history.state, "", url.pathname + url.search);
  }, []);
  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    const result = passwordSchema.safeParse(password);
    if (!result.success) {
      setError(result.error.issues[0].message);
      return;
    }
    if (password !== confirmation) {
      setError("Passwords must match.");
      return;
    }
    setBusy(true);
    try {
      await finishPasswordReset(token, password);
      resetToken();
      setPassword("");
      setConfirmation("");
      setDone(true);
    } catch (cause) {
      toast.error(authErrorMessage(cause, "Reset unavailable."));
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="auth-page">
      <div className="auth-brand">
        <Brand />
      </div>
      <LoginShowcase />
      <div className="auth-form-side">
        <section className="auth-content" aria-labelledby="reset-title">
          {!done && (
            <a className="auth-back" href="/login">
              <ArrowLeft size={14} aria-hidden="true" />
              Back to sign in
            </a>
          )}
          <h1 id="reset-title">{done ? "Password updated" : "Reset your password"}</h1>
          {done ? (
            <>
              <p>All sessions have been signed out. Use your new password to sign in.</p>
              <a className="button button-primary" href="/login">
                Sign in
              </a>
            </>
          ) : !token ? (
            <>
              <ResetEmailRequest />
            </>
          ) : (
            <>
              <p>Use at least 8 characters, including one special character.</p>
              <form onSubmit={(event) => void submit(event)}>
                <label htmlFor="reset-password">New password</label>
                <div className="auth-password">
                  <input
                    id="reset-password"
                    type={visible ? "text" : "password"}
                    autoComplete="new-password"
                    minLength={8}
                    maxLength={128}
                    required
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    disabled={busy}
                  />
                  <button
                    type="button"
                    className="icon-button"
                    aria-label={visible ? "Hide password" : "Show password"}
                    onClick={() => setVisible(!visible)}
                  >
                    {visible ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>
                <label htmlFor="reset-confirm">Confirm password</label>
                <input
                  id="reset-confirm"
                  type={visible ? "text" : "password"}
                  autoComplete="new-password"
                  required
                  value={confirmation}
                  onChange={(event) => setConfirmation(event.target.value)}
                  disabled={busy}
                />
                <button className="button button-primary auth-submit" disabled={busy}>
                  {busy ? "Updating…" : "Update password"}
                </button>
              </form>
            </>
          )}
          {error && (
            <p className="auth-error" role="alert">
              {error}
            </p>
          )}
        </section>
      </div>
    </main>
  );
}

function ResetEmailRequest() {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);
  const cooldown = useCooldown();
  return (
    <>
      <p>
        {new URLSearchParams(location.search).has("error")
          ? "This link expired. Request a fresh reset email."
          : "Enter your email to receive a password-reset link."}
      </p>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          setError("");
          const result = emailSchema.safeParse(email);
          if (!result.success) {
            setError("Enter a valid email address.");
            return;
          }
          setBusy(true);
          void requestPasswordReset(result.data)
            .then(() => {
              setSent(true);
              cooldown.start(60);
            })
            .catch((cause) => {
              if (cause instanceof AccountRateLimitError) cooldown.start(cause.retryAfter);
              toast.error(authErrorMessage(cause, "Could not request reset."));
            })
            .finally(() => setBusy(false));
        }}
      >
        <label htmlFor="reset-email">Email</label>
        <input
          id="reset-email"
          type="email"
          autoComplete="email"
          required
          maxLength={254}
          value={email}
          onChange={(event) => {
            if (emailInputSchema.safeParse(event.target.value).success)
              setEmail(event.target.value);
          }}
          disabled={busy}
        />
        <button
          className="button button-primary auth-submit"
          disabled={busy || cooldown.remaining > 0}
        >
          {cooldown.remaining ? `Resend available in ${cooldown.remaining}s` : "Send reset link"}
        </button>
      </form>
      {sent && (
        <p role="status">If this address has an account, check its inbox for a reset link.</p>
      )}
      {error && (
        <p className="auth-error" role="alert">
          {error}
        </p>
      )}
    </>
  );
}
