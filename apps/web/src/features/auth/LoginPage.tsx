/** @file LoginPage.tsx @description Theme-aware credential, passkey and provider sign-in. @module auth */
import { useEffect, useState, type FormEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Eye, EyeOff, Fingerprint } from "lucide-react";
import { signIn, signInDestination, signInWithPassword } from "./session";
import {
  fetchAuthCapabilities,
  registerAccount,
  resendVerificationEmail,
  signInWithPasskey,
  signInWithProvider,
} from "./capabilities";
import { Brand } from "../editor/components/Icon";
import { useTheme } from "../editor/useTheme";
import { LoginShowcase } from "./LoginShowcase";
import "./auth.css";

export function LoginPage() {
  useTheme();
  const capabilities = useQuery({
    queryKey: ["auth-capabilities"],
    queryFn: fetchAuthCapabilities,
    retry: false,
  });
  useEffect(() => {
    const origin = capabilities.data?.preferredOrigin;
    if (origin && origin !== location.origin) location.replace(`${origin}/login${location.search}`);
  }, [capabilities.data?.preferredOrigin]);
  const [creating, setCreating] = useState(false);
  const [email, setEmail] = useState("");
  const [submittedEmail, setSubmittedEmail] = useState("");
  const [resent, setResent] = useState(false);
  const verified = new URLSearchParams(location.search).get("verified") === "1";
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [visible, setVisible] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const passkeySupported = typeof PublicKeyCredential !== "undefined";
  async function authenticate(action: () => Promise<unknown>) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Sign in unavailable. Try again.");
    } finally {
      setBusy(false);
    }
  }
  function submit(event: FormEvent) {
    event.preventDefault();
    void authenticate(async () => {
      if (creating) {
        if (!capabilities.data?.registration) throw new Error("Account creation is unavailable.");
        await registerAccount({
          name: username.trim(),
          username: username.trim(),
          email: email.trim(),
          password,
        });
        setSubmittedEmail(email.trim());
        setPassword("");
        setVisible(false);
      } else if (capabilities.data?.method === "password")
        await signInWithPassword(username.trim(), password);
      else await signIn();
    });
  }
  return (
    <main className="auth-page">
      <a className="auth-back" href={signInDestination()}>
        <ArrowLeft size={16} aria-hidden="true" />
        Back
      </a>
      <div className="auth-brand">
        <Brand />
      </div>
      <LoginShowcase />
      <div className="auth-form-side">
        <section className="auth-content" aria-labelledby="sign-in-title">
          <h1 id="sign-in-title">
            {submittedEmail
              ? "Check your email"
              : creating
                ? "Create your account"
                : "Sign in to Quorem"}
          </h1>
          <p>
            {submittedEmail
              ? `Open the verification link sent to ${submittedEmail}, then sign in.`
              : creating
                ? "Start practicing with Quorem."
                : "Pick up where you left off."}
          </p>
          {verified && !creating && !submittedEmail ? (
            <p className="auth-success" role="status">
              Email verified. You can sign in now.
            </p>
          ) : null}
          {submittedEmail ? (
            <div className="auth-verification">
              <button
                type="button"
                className="button button-primary"
                disabled={busy}
                onClick={() => {
                  setSubmittedEmail("");
                  setCreating(false);
                  setUsername(email);
                  setError("");
                }}
              >
                Back to sign in
              </button>
              <button
                type="button"
                className="quiet-button"
                disabled={busy}
                onClick={() =>
                  void authenticate(async () => {
                    await resendVerificationEmail(submittedEmail);
                    setResent(true);
                  })
                }
              >
                {busy ? "Sending…" : "Resend verification email"}
              </button>
              {resent ? <p role="status">Verification email sent.</p> : null}
              {error ? (
                <p className="auth-error" role="alert">
                  {error}
                </p>
              ) : null}
            </div>
          ) : capabilities.isPending ? (
            <p role="status">Loading sign in…</p>
          ) : capabilities.isError ? (
            <>
              <p role="alert">Sign in unavailable.</p>
              <button className="button" onClick={() => void capabilities.refetch()}>
                Try again
              </button>
            </>
          ) : (
            <>
              <div className="auth-providers" aria-label="Social sign in">
                {(["google", "apple", "github"] as const).map((provider) => {
                  const enabled = capabilities.data?.providers.includes(provider);
                  return (
                    <button
                      key={provider}
                      type="button"
                      className="button auth-provider"
                      disabled={busy || !enabled}
                      onClick={() => void authenticate(() => signInWithProvider(provider))}
                      aria-describedby={!enabled ? "auth-provider-note" : undefined}
                    >
                      {provider === "github" ? (
                        <svg
                          width="18"
                          height="18"
                          viewBox="0 0 24 24"
                          fill="currentColor"
                          aria-hidden="true"
                        >
                          <path d="M12 .75a11.25 11.25 0 0 0-3.56 21.92c.56.1.77-.24.77-.54v-2.1c-3.14.68-3.8-1.34-3.8-1.34-.52-1.31-1.26-1.66-1.26-1.66-1.03-.7.08-.69.08-.69 1.14.08 1.74 1.17 1.74 1.17 1.01 1.73 2.65 1.23 3.3.94.1-.73.4-1.23.72-1.51-2.5-.29-5.13-1.25-5.13-5.56 0-1.23.44-2.23 1.16-3.02-.12-.29-.5-1.43.11-2.98 0 0 .95-.3 3.1 1.16a10.8 10.8 0 0 1 5.64 0c2.15-1.45 3.1-1.16 3.1-1.16.61 1.55.23 2.7.11 2.98.72.79 1.16 1.79 1.16 3.02 0 4.32-2.64 5.27-5.15 5.55.41.36.77 1.05.77 2.12v3.08c0 .3.2.65.78.54A11.25 11.25 0 0 0 12 .75Z" />
                        </svg>
                      ) : provider === "google" ? (
                        <svg
                          width="18"
                          height="18"
                          viewBox="0 0 24 24"
                          fill="currentColor"
                          aria-hidden="true"
                        >
                          <path d="M21.8 12.2c0-.7-.06-1.4-.19-2.1H12v4h5.5a4.7 4.7 0 0 1-2 3.1 6 6 0 1 1-.2-10.1l3-3A10.2 10.2 0 1 0 12 22.2c5.7 0 9.8-4 9.8-10Z" />
                        </svg>
                      ) : (
                        <svg
                          width="18"
                          height="18"
                          viewBox="0 0 24 24"
                          fill="currentColor"
                          aria-hidden="true"
                        >
                          <path d="M17.05 12.54c.02 3.12 2.74 4.16 2.77 4.17-.02.07-.43 1.48-1.43 2.93-.86 1.25-1.75 2.5-3.16 2.52-1.38.03-1.83-.82-3.41-.82-1.57 0-2.07.79-3.38.85-1.36.05-2.39-1.36-3.26-2.6-1.77-2.55-3.12-7.2-1.3-10.34.9-1.56 2.5-2.55 4.24-2.58 1.32-.03 2.57.9 3.38.9.82 0 2.34-1.11 3.95-.94.67.03 2.56.27 3.78 2.06-.1.06-2.26 1.32-2.24 3.85ZM14.45 4.94c.72-.87 1.21-2.08 1.08-3.29-1.04.04-2.3.69-3.05 1.56-.67.77-1.26 2-1.1 3.18 1.16.09 2.35-.59 3.07-1.45Z" />
                        </svg>
                      )}
                      {provider === "google" ? "Google" : provider === "apple" ? "Apple" : "GitHub"}
                    </button>
                  );
                })}
              </div>
              {capabilities.data?.providers.length !== 3 ? (
                <p id="auth-provider-note" className="auth-note">
                  Unavailable providers aren’t configured yet.
                </p>
              ) : null}
              <div className="auth-divider">
                <span>or</span>
              </div>
              <form onSubmit={submit}>
                {capabilities.data?.method === "password" ? (
                  <>
                    <label htmlFor="auth-username">
                      {creating ? "Username" : "Username or email"}
                    </label>
                    <input
                      id="auth-username"
                      name="username"
                      autoComplete="username"
                      required
                      maxLength={creating ? 30 : 254}
                      minLength={creating ? 3 : undefined}
                      pattern={creating ? "[a-zA-Z0-9_]+" : undefined}
                      title={creating ? "3–30 letters, numbers or underscores" : undefined}
                      value={username}
                      onChange={(event) => setUsername(event.target.value)}
                      disabled={busy}
                      autoCapitalize="none"
                      spellCheck={false}
                    />
                    {creating ? (
                      <>
                        <label htmlFor="auth-email">Email</label>
                        <input
                          id="auth-email"
                          name="email"
                          type="email"
                          autoComplete="email"
                          autoCapitalize="none"
                          spellCheck={false}
                          required
                          maxLength={254}
                          disabled={busy}
                          value={email}
                          onChange={(event) => setEmail(event.target.value)}
                        />
                      </>
                    ) : null}
                    <label htmlFor="auth-password">Password</label>
                    <div className="auth-password">
                      <input
                        id="auth-password"
                        name="password"
                        type={visible ? "text" : "password"}
                        autoComplete={creating ? "new-password" : "current-password"}
                        minLength={creating ? 12 : undefined}
                        maxLength={creating ? 128 : undefined}
                        required
                        value={password}
                        onChange={(event) => setPassword(event.target.value)}
                        disabled={busy}
                      />
                      <button
                        type="button"
                        className="icon-button"
                        aria-label={visible ? "Hide password" : "Show password"}
                        aria-pressed={visible}
                        onClick={() => setVisible(!visible)}
                      >
                        {visible ? <EyeOff size={18} /> : <Eye size={18} />}
                      </button>
                    </div>
                  </>
                ) : null}
                <button className="button button-primary auth-submit" type="submit" disabled={busy}>
                  {busy
                    ? creating
                      ? "Creating account…"
                      : "Signing in…"
                    : creating
                      ? "Create account"
                      : capabilities.data?.method === "password"
                        ? "Sign in"
                        : "Continue to sign in"}
                </button>
              </form>
              {creating ? (
                <p className="auth-note">Use at least 12 characters for your password.</p>
              ) : null}
              {!creating && capabilities.data?.passkey ? (
                <button
                  className="button auth-passkey"
                  disabled={busy || !passkeySupported}
                  onClick={() => void authenticate(signInWithPasskey)}
                >
                  <Fingerprint size={18} />
                  Sign in with a passkey
                </button>
              ) : null}
              {!creating && capabilities.data?.passkey && !passkeySupported ? (
                <p className="auth-note">Passkeys require a supported browser.</p>
              ) : null}
              {capabilities.data?.registration ? (
                <p className="auth-mode-toggle">
                  {creating ? "Already have an account?" : "New to Quorem?"}{" "}
                  <button
                    type="button"
                    className="quiet-button"
                    disabled={busy}
                    onClick={() => {
                      setCreating(!creating);
                      setPassword("");
                      setVisible(false);
                      setError("");
                      setResent(false);
                    }}
                  >
                    {creating ? "Sign in" : "Create account"}
                  </button>
                </p>
              ) : null}
              {error ? (
                <p className="auth-error" role="alert">
                  {error}
                </p>
              ) : null}
            </>
          )}
        </section>
      </div>
    </main>
  );
}
