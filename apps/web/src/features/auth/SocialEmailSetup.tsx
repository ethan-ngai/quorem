import { useEffect, useState } from "react";
import { ArrowLeft } from "lucide-react";
import { useTheme } from "../editor/useTheme";
import { Brand } from "../../ui/Icon";
import { LoginShowcase } from "./LoginShowcase";
import { accountRequest, connectProvider } from "./account";
import { signInWithProvider, type SocialProvider } from "./capabilities";
import { authErrorMessage } from "./errors";
import { useCooldown } from "../../ui/useCooldown";
import "./auth.css";

export function SocialEmailSetup() {
  useTheme();
  const [token] = useState(
    () => new URLSearchParams(location.search).get("socialEmailToken") ?? "",
  );
  useEffect(() => {
    const url = new URL(location.href);
    url.searchParams.delete("socialEmailToken");
    url.searchParams.set("socialEmail", "1");
    history.replaceState(history.state, "", url.pathname + url.search);
  }, []);
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const cooldown = useCooldown();
  async function submit() {
    setBusy(true);
    setError("");
    try {
      if (token) {
        const result = (await accountRequest("social-email/verify", { token })) as {
          provider: SocialProvider;
          linking: boolean;
        };
        if (result.linking) await connectProvider(result.provider);
        else await signInWithProvider(result.provider);
      } else {
        await accountRequest("social-email/start", { email });
        setSent(true);
        cooldown.start(60);
      }
    } catch (cause) {
      setError(
        authErrorMessage(
          cause,
          "Email verification unavailable. Restart social sign-in if the link expired.",
        ),
      );
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
        <section className="auth-content">
          <a className="auth-back" href="/login">
            <ArrowLeft size={14} aria-hidden="true" />
            Back to sign in
          </a>
          <h1>{token ? "Finish email verification" : "Add your email"}</h1>
          <p>
            {token
              ? "Continue in the browser where you started. Confirm your social account again to finish signing in."
              : "Your provider didn’t share an email. Every account needs one; verify yours to continue."}
          </p>
          <form
            className="auth-form"
            onSubmit={(event) => {
              event.preventDefault();
              void submit();
            }}
          >
            {!token && (
              <label>
                Email
                <input
                  type="email"
                  required
                  maxLength={254}
                  autoComplete="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  disabled={busy}
                />
              </label>
            )}
            {sent && (
              <p role="status">Check {email} for a verification link. Open it in this browser.</p>
            )}
            {error && <p role="alert">{error}</p>}
            <button className="button button-primary" disabled={busy || cooldown.remaining > 0}>
              {busy
                ? "Continuing…"
                : token
                  ? "Verify and continue"
                  : cooldown.remaining
                    ? `Resend in ${cooldown.remaining}s`
                    : sent
                      ? "Resend verification"
                      : "Verify email"}
            </button>
          </form>
        </section>
      </div>
    </main>
  );
}
