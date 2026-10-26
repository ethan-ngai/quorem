import { SocialEmailSetup } from "./SocialEmailSetup";
import { LoadingScreen } from "../../ui/LoadingScreen";
/** @file LoginPage.tsx @description Theme-aware credential, passkey and provider sign-in. @module auth */
import { useErrorNotification } from "../../ui/Notifications";
import { authErrorMessage, AuthError } from "./errors";
import {
  accountSetupSchema,
  emailSchema,
  emailInputSchema,
  usernameInputSchema,
} from "@quorem/contracts/auth";
import { useEffect, useState, type FormEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Eye, EyeOff, Fingerprint } from "lucide-react";
import { signIn, signInWithPassword } from "./session";
import { signInReferral } from "./signInReferral";
import {
  fetchAuthCapabilities,
  beginRegistration,
  registrationStatus,
  completeRegistration,
  signInWithPasskey,
  signInWithProvider,
  socialProviders,
  socialProviderLabels,
} from "./capabilities";
import { Brand } from "../../ui/Icon";
import { useTheme } from "../editor/useTheme";
import { useCooldown } from "../../ui/useCooldown";
import { UsernameRules } from "./UsernameRules";
import { PasswordReset } from "./PasswordReset";
import { LoginShowcase } from "./LoginShowcase";
import "./auth.css";

export function LoginPage() {
  if (
    new URLSearchParams(location.search).has("socialEmail") ||
    new URLSearchParams(location.search).has("socialEmailToken")
  )
    return <SocialEmailSetup />;
  if (new URLSearchParams(location.search).get("reset") === "1") return <PasswordReset />;
  return <LoginForm />;
}

function LoginForm() {
  const backDestination = signInReferral(location.search, document.referrer, location.origin);
  const { preference, setPreference } = useTheme();
  const capabilities = useQuery({
    queryKey: ["auth-capabilities"],
    queryFn: fetchAuthCapabilities,
    retry: false,
  });
  useEffect(() => {
    const origin = capabilities.data?.preferredOrigin;
    if (!origin) return;
    const destination = new URL(`/login${location.search}`, origin);
    if (origin !== location.origin) {
      destination.searchParams.set("authTheme", preference);
      location.replace(destination.toString());
      return;
    }
    const requested = destination.searchParams.get("authTheme");
    if (requested === "light" || requested === "dark" || requested === "system") {
      setPreference(requested);
      destination.searchParams.delete("authTheme");
      history.replaceState(history.state, "", destination.pathname + destination.search);
    }
  }, [capabilities.data?.preferredOrigin, preference, setPreference]);
  const [signupToken] = useState(
    () => new URLSearchParams(location.search).get("signupToken") ?? "",
  );
  const setupRequested = Boolean(signupToken || new URLSearchParams(location.search).get("setup"));
  const setup = useQuery({
    queryKey: ["registration-setup", signupToken],
    queryFn: () => registrationStatus(signupToken || undefined),
    enabled: setupRequested,
    retry: false,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  });
  useEffect(() => {
    if (!signupToken) return;
    const url = new URL(location.href);
    url.searchParams.delete("signupToken");
    url.searchParams.set("setup", "1");
    history.replaceState(history.state, "", url.pathname + url.search);
  }, [signupToken]);
  const finishing = Boolean(setup.data && !setup.data.registered);
  const [creating, setCreating] = useState(
    setupRequested || new URLSearchParams(location.search).get("create") === "1",
  );
  const [email, setEmail] = useState("");
  const [submittedEmail, setSubmittedEmail] = useState("");
  const resend = useCooldown();
  const verified = new URLSearchParams(location.search).get("verified") === "1";
  const [name, setName] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [visible, setVisible] = useState(false);
  const [error, setError] = useState("");
  useErrorNotification(error);
  const [busy, setBusy] = useState(false);
  const passkeySupported = typeof PublicKeyCredential !== "undefined";
  async function authenticate(action: () => Promise<unknown>) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (cause) {
      setError(authErrorMessage(cause, "Sign in unavailable. Try again."));
    } finally {
      setBusy(false);
    }
  }
  function submit(event: FormEvent) {
    event.preventDefault();
    void authenticate(async () => {
      if (creating) {
        if (!capabilities.data?.registration)
          throw new AuthError("Account creation is unavailable.");
        if (finishing) {
          const parsed = accountSetupSchema.safeParse({
            email: setup.data?.email,
            username,
            password,
            name,
          });
          if (!parsed.success) throw new AuthError(parsed.error.issues[0].message);
          await completeRegistration(
            parsed.data.email,
            parsed.data.username,
            parsed.data.password,
            parsed.data.name,
          );
          await signInWithPassword(username.trim(), password);
          return;
        }
        const parsed = emailSchema.safeParse(email);
        if (!parsed.success) throw new AuthError(parsed.error.issues[0].message);
        const sent = await beginRegistration(parsed.data);
        setSubmittedEmail(email.trim());
        resend.start(sent.retryAfter);
        setPassword("");
        setVisible(false);
      } else if (capabilities.data?.method === "password")
        await signInWithPassword(username.trim(), password);
      else await signIn();
    });
  }
  return (
    <main className="auth-page">
      <div className="auth-brand">
        <Brand />
      </div>
      <LoginShowcase />
      <div className="auth-form-side">
        <section className="auth-content" aria-labelledby="sign-in-title">
          {backDestination ? (
            <a className="auth-back" href={backDestination}>
              <ArrowLeft size={14} aria-hidden="true" />
              Back
            </a>
          ) : null}
          <h1 id="sign-in-title">
            {setup.data?.registered
              ? "Account already exists"
              : setup.isError
                ? "Link unavailable"
                : submittedEmail
                  ? "Check your email"
                  : finishing
                    ? "Finish your account"
                    : creating
                      ? "Create your account"
                      : "Sign in to Quorem"}
          </h1>
          <p>
            {setup.data?.registered || setup.isError
              ? "Continue below to get back into your account."
              : submittedEmail
                ? `Check ${submittedEmail} for a setup link. Open it to continue.`
                : finishing
                  ? `Email verified: ${setup.data?.email}. Choose your username and password.`
                  : creating
                    ? "Verify your email first. Then choose your username and password."
                    : "Pick up where you left off."}
          </p>
          {new URLSearchParams(location.search).has("error") && (
            <p role="alert">
              {new URLSearchParams(location.search).get("error") === "account_not_linked"
                ? "An account with this email already exists. Sign in to that account first, then open Settings → Social accounts to connect this provider."
                : "Could not connect your social account. Sign in and try again from Settings → Social accounts."}
            </p>
          )}
          {new URLSearchParams(location.search).has("emailChanged") && (
            <p className="auth-success" role="status">
              Email updated. Your new address is verified.
            </p>
          )}
          {new URLSearchParams(location.search).has("emailChangePending") && (
            <p role="status">
              Current address confirmed. Check your new inbox to finish the change.
            </p>
          )}
          {verified && !creating && !submittedEmail ? (
            <p className="auth-success" role="status">
              Email verified. You can sign in now.
            </p>
          ) : null}
          {setupRequested && setup.isPending ? (
            <p role="status">Verifying your email…</p>
          ) : setupRequested && (setup.isError || setup.data?.registered) ? (
            <div className="auth-verification">
              <p role="status">
                {setup.data?.registered
                  ? "You already have an account. Sign in to continue."
                  : authErrorMessage(
                      setup.error,
                      "Account setup unavailable. Request a new email.",
                    )}
              </p>
              <button
                type="button"
                className="button button-primary"
                onClick={() => {
                  const url = new URL(location.href);
                  url.searchParams.delete("setup");
                  location.assign(url.pathname + url.search);
                }}
              >
                Back to sign in
              </button>
              {setup.isError && (
                <button
                  type="button"
                  className="quiet-button"
                  onClick={() => {
                    const url = new URL(location.href);
                    url.searchParams.delete("setup");
                    url.searchParams.set("create", "1");
                    location.assign(url.pathname + url.search);
                  }}
                >
                  Request a new setup email
                </button>
              )}
            </div>
          ) : submittedEmail ? (
            <div className="auth-verification">
              <button
                type="button"
                className="button button-primary"
                disabled={busy}
                onClick={() => {
                  setSubmittedEmail("");
                  setCreating(true);
                  setError("");
                }}
              >
                Change email
              </button>
              <button
                type="button"
                className="quiet-button"
                disabled={busy || resend.remaining > 0}
                onClick={() =>
                  void authenticate(async () => {
                    const sent = await beginRegistration(submittedEmail);
                    resend.start(sent.retryAfter);
                  })
                }
              >
                {busy
                  ? "Sending…"
                  : resend.remaining > 0
                    ? `Resend email in ${resend.remaining}s`
                    : "Resend verification email"}
              </button>

              {finishing && /expired|another tab/.test(error) ? (
                <button
                  type="button"
                  className="quiet-button"
                  onClick={() => {
                    const url = new URL(location.href);
                    url.searchParams.delete("setup");
                    url.searchParams.set("create", "1");
                    location.assign(url.pathname + url.search);
                  }}
                >
                  Request a new setup email
                </button>
              ) : null}
            </div>
          ) : capabilities.isPending ? (
            <LoadingScreen inline label="Loading sign in…" />
          ) : capabilities.isError ? (
            <>
              <p role="alert">Sign in unavailable.</p>
              <button className="button" onClick={() => void capabilities.refetch()}>
                Try again
              </button>
            </>
          ) : (
            <>
              {!finishing && (
                <>
                  <div className="auth-providers" aria-label="Social sign in">
                    {socialProviders.map((provider) => {
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
                          ) : (
                            <svg
                              width="18"
                              height="18"
                              viewBox="0 0 24 24"
                              fill="currentColor"
                              aria-hidden="true"
                            >
                              <path d="M21.8 12.2c0-.7-.06-1.4-.19-2.1H12v4h5.5a4.7 4.7 0 0 1-2 3.1 6 6 0 1 1-.2-10.1l3-3A10.2 10.2 0 1 0 12 22.2c5.7 0 9.8-4 9.8-10Z" />
                            </svg>
                          )}
                          {socialProviderLabels[provider]}
                        </button>
                      );
                    })}
                  </div>
                  {socialProviders.some(
                    (provider) => !capabilities.data?.providers.includes(provider),
                  ) ? (
                    <p id="auth-provider-note" className="auth-note">
                      Unavailable providers aren’t configured yet.
                    </p>
                  ) : null}
                  <div className="auth-divider">
                    <span>or</span>
                  </div>
                </>
              )}
              <form onSubmit={submit}>
                {capabilities.data?.method === "password" ? (
                  <>
                    {!creating || finishing ? (
                      <>
                        <label htmlFor="auth-username">
                          {creating ? "Username" : "Username or email"}
                        </label>
                        <input
                          aria-describedby={finishing ? "signup-username-rules" : undefined}
                          id="auth-username"
                          name="username"
                          autoComplete="username"
                          required
                          maxLength={creating ? 30 : 254}
                          minLength={creating ? 3 : undefined}
                          pattern={creating ? "[a-z0-9]+" : undefined}
                          title={creating ? "3–30 lowercase letters or digits" : undefined}
                          value={username}
                          onChange={(event) => {
                            if (!finishing) {
                              setUsername(event.target.value);
                              return;
                            }
                            const value = event.target.value
                              .toLowerCase()
                              .replace(/[^a-z0-9]/g, "");
                            if (usernameInputSchema.safeParse(value).success) setUsername(value);
                          }}
                          disabled={busy}
                          autoCapitalize="none"
                          spellCheck={false}
                        />
                        {finishing && <UsernameRules id="signup-username-rules" />}
                        {finishing ? (
                          <>
                            <label htmlFor="auth-name">
                              Name <span>(optional)</span>
                            </label>
                            <input
                              id="auth-name"
                              name="name"
                              autoComplete="name"
                              maxLength={80}
                              value={name}
                              onChange={(event) => setName(event.target.value)}
                              disabled={busy}
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
                            minLength={creating ? 8 : undefined}
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
                    {creating && !finishing ? (
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
                          onChange={(event) => {
                            if (emailInputSchema.safeParse(event.target.value).success)
                              setEmail(event.target.value);
                          }}
                        />
                      </>
                    ) : null}
                  </>
                ) : null}
                <button className="button button-primary auth-submit" type="submit" disabled={busy}>
                  {busy
                    ? creating
                      ? finishing
                        ? "Creating account…"
                        : "Sending email…"
                      : "Signing in…"
                    : creating
                      ? finishing
                        ? "Create account"
                        : "Continue with email"
                      : capabilities.data?.method === "password"
                        ? "Sign in"
                        : "Continue to sign in"}
                </button>
              </form>
              {!creating && capabilities.data?.registration && (
                <a className="quiet-button auth-forgot" href="/login?reset=1">
                  Forgot password?
                </a>
              )}
              {finishing ? (
                <p className="auth-note">
                  Use at least 8 characters, including one special character.
                </p>
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
              {capabilities.data?.registration && !finishing ? (
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
                    }}
                  >
                    {creating ? "Sign in" : "Create account"}
                  </button>
                </p>
              ) : null}

              {finishing && /expired|another tab/.test(error) ? (
                <button
                  type="button"
                  className="quiet-button"
                  onClick={() => {
                    const url = new URL(location.href);
                    url.searchParams.delete("setup");
                    url.searchParams.set("create", "1");
                    location.assign(url.pathname + url.search);
                  }}
                >
                  Request a new setup email
                </button>
              ) : null}
            </>
          )}
        </section>
      </div>
    </main>
  );
}
