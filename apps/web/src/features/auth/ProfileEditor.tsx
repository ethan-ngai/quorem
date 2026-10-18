import { useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  emailInputSchema,
  emailSchema,
  optionalNameSchema,
  usernameInputSchema,
  usernameSchema,
} from "@quorem/contracts/auth";
import { fetchAuthCapabilities } from "./capabilities";
import {
  AccountRateLimitError,
  updateAccount,
  requestEmailChange,
  requestPasswordReset,
} from "./account";
import { fetchProfile, type AccountProfile } from "./profile";
import { resetToken } from "./session";
import { UsernameRules } from "./UsernameRules";
import { useCooldown } from "../../ui/useCooldown";
import "./profile-editor.css";

export function ProfileEditor({ profile, userId }: { profile: AccountProfile; userId: string }) {
  const [name, setName] = useState(profile.name);
  const [username, setUsername] = useState(profile.username ?? "");
  const [email, setEmail] = useState(profile.email);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const emailCooldown = useCooldown(),
    resetCooldown = useCooldown();
  const client = useQueryClient();
  const capabilities = useQuery({
    queryKey: ["auth-capabilities"],
    queryFn: fetchAuthCapabilities,
  });
  const localCredentials = capabilities.data?.method === "password";
  async function run(
    action: () => Promise<void>,
    success: string,
    limited?: (seconds: number) => void,
  ) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await action();
      setMessage(success);
    } catch (cause) {
      if (cause instanceof AccountRateLimitError) limited?.(cause.retryAfter);
      setError(cause instanceof Error ? cause.message : "Account update unavailable.");
    } finally {
      setBusy(false);
    }
  }
  function save(event: FormEvent) {
    event.preventDefault();
    const parsedName = optionalNameSchema.safeParse(name),
      parsedUsername = usernameSchema.safeParse(username);
    if (!parsedName.success || (localCredentials && !parsedUsername.success)) {
      setError("Check your name and username against the rules below.");
      return;
    }
    void run(async () => {
      await updateAccount(parsedName.data, localCredentials ? username : undefined);
      resetToken();
      client.setQueryData(["account-profile", userId], await fetchProfile());
      await client.invalidateQueries({ queryKey: ["auth-session"] });
    }, "Profile saved.");
  }
  return (
    <div className="profile-editor">
      <form className="account-form" onSubmit={save}>
        <label htmlFor="profile-name">Name (optional)</label>
        <input
          id="profile-name"
          autoComplete="name"
          maxLength={80}
          value={name}
          onChange={(event) => setName(event.target.value)}
          disabled={busy}
        />
        {localCredentials && (
          <>
            <label htmlFor="profile-username">Username</label>
            <input
              id="profile-username"
              autoComplete="username"
              required
              minLength={3}
              maxLength={30}
              aria-describedby="profile-username-rules"
              value={username}
              onChange={(event) => {
                const value = event.target.value.toLowerCase().replace(/[^a-z0-9]/g, "");
                if (usernameInputSchema.safeParse(value).success) setUsername(value);
              }}
              disabled={busy}
            />
            <UsernameRules id="profile-username-rules" />
          </>
        )}
        <button className="button button-primary" disabled={busy} type="submit">
          Save profile
        </button>
      </form>
      <form
        className="account-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (!emailSchema.safeParse(email).success) {
            setError("Enter a valid email address.");
            return;
          }
          void run(
            async () => {
              await requestEmailChange(email);
              emailCooldown.start(60);
            },
            "Check your current inbox to approve the change, then verify the new address. Your email stays unchanged until both steps finish.",
            (seconds) => emailCooldown.start(seconds),
          );
        }}
      >
        <label htmlFor="profile-email">Email</label>
        <input
          id="profile-email"
          type="email"
          autoComplete="email"
          maxLength={254}
          value={email}
          onChange={(event) => {
            if (emailInputSchema.safeParse(event.target.value).success)
              setEmail(event.target.value);
          }}
          disabled={busy || !capabilities.data?.registration}
          required
        />
        {capabilities.data?.registration && (
          <button
            className="button"
            type="submit"
            disabled={busy || email === profile.email || emailCooldown.remaining > 0}
          >
            {emailCooldown.remaining
              ? `Resend available in ${emailCooldown.remaining}s`
              : "Verify email change"}
          </button>
        )}
      </form>
      {capabilities.data?.registration && (
        <section className="account-form">
          <h3>Password</h3>
          <p>
            We’ll email a reset link to your verified address. Resetting your password signs out all
            devices.
          </p>
          <button
            className="button"
            type="button"
            disabled={busy || resetCooldown.remaining > 0}
            onClick={() =>
              void run(
                async () => {
                  await requestPasswordReset(profile.email);
                  resetCooldown.start(60);
                },
                "Check your email for a password-reset link.",
                (seconds) => resetCooldown.start(seconds),
              )
            }
          >
            {resetCooldown.remaining
              ? `Resend available in ${resetCooldown.remaining}s`
              : "Send password-reset link"}
          </button>
        </section>
      )}
      {message && <p role="status">{message}</p>}
      {error && (
        <p className="account-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
