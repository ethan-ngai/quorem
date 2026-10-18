import { Pencil } from "lucide-react";
import { type ReactNode, useState, type FormEvent } from "react";
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
  const [editing, setEditing] = useState<"name" | "username" | "email" | "password" | null>(null);
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
  function edit(field: typeof editing) {
    setName(profile.name);
    setUsername(profile.username ?? "");
    setEmail(profile.email);
    setError("");
    setMessage("");
    setEditing(field);
  }
  function save(event: FormEvent) {
    event.preventDefault();
    const parsedName = optionalNameSchema.safeParse(name),
      parsedUsername = usernameSchema.safeParse(username);
    if (
      (editing === "name" && !parsedName.success) ||
      (editing === "username" && !parsedUsername.success)
    ) {
      setError("Check this field against its rules.");
      return;
    }
    void run(async () => {
      await updateAccount(
        editing === "name" ? parsedName.data! : profile.name,
        editing === "username" ? parsedUsername.data : undefined,
      );
      resetToken();
      client.setQueryData(["account-profile", userId], await fetchProfile());
      await client.invalidateQueries({ queryKey: ["auth-session"] });
      setEditing(null);
    }, "Profile saved.");
  }
  const cancel = (
    <button className="button" type="button" disabled={busy} onClick={() => edit(null)}>
      Cancel
    </button>
  );
  return (
    <div className="profile-editor">
      <ProfileField
        label="Name (optional)"
        value={profile.name || "Not set"}
        editing={editing === "name"}
        onEdit={() => edit("name")}
        disabled={busy}
      >
        <form className="account-form" onSubmit={save}>
          <input
            aria-label="Name (optional)"
            autoFocus
            autoComplete="name"
            maxLength={80}
            value={name}
            onChange={(event) => setName(event.target.value)}
            disabled={busy}
          />
          <div className="profile-edit-actions">
            <button className="button button-primary" disabled={busy}>
              Save name
            </button>
            {cancel}
          </div>
        </form>
      </ProfileField>
      {localCredentials && (
        <ProfileField
          label="Username"
          value={profile.username ?? "Not set"}
          editing={editing === "username"}
          onEdit={() => edit("username")}
          disabled={busy}
        >
          <form className="account-form" onSubmit={save}>
            <input
              aria-label="Username"
              autoFocus
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
            <div className="profile-edit-actions">
              <button className="button button-primary" disabled={busy}>
                Save username
              </button>
              {cancel}
            </div>
          </form>
        </ProfileField>
      )}
      <ProfileField
        label="Email"
        value={profile.email}
        editing={editing === "email"}
        onEdit={capabilities.data?.registration ? () => edit("email") : undefined}
        disabled={busy}
      >
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
                setEditing(null);
              },
              "Check your current inbox to approve the change, then verify the new address.",
              (seconds) => emailCooldown.start(seconds),
            );
          }}
        >
          <input
            aria-label="Email"
            autoFocus
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
          <div className="profile-edit-actions">
            <button
              className="button button-primary"
              disabled={busy || email === profile.email || emailCooldown.remaining > 0}
            >
              {emailCooldown.remaining
                ? `Retry in ${emailCooldown.remaining}s`
                : "Verify email change"}
            </button>
            {cancel}
          </div>
        </form>
      </ProfileField>
      {capabilities.data?.registration && (
        <ProfileField
          label="Password"
          value="••••••••"
          editing={editing === "password"}
          onEdit={() => edit("password")}
          disabled={busy}
        >
          <div className="account-form">
            <p>
              We’ll email a reset link to your verified address. Resetting your password signs out
              all devices.
            </p>
            <div className="profile-edit-actions">
              <button
                className="button button-primary"
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
                  ? `Retry in ${resetCooldown.remaining}s`
                  : "Send password-reset link"}
              </button>
              {cancel}
            </div>
          </div>
        </ProfileField>
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

function ProfileField({
  label,
  value,
  editing,
  onEdit,
  disabled,
  children,
}: {
  label: string;
  value: string;
  editing: boolean;
  onEdit?: () => void;
  disabled: boolean;
  children: ReactNode;
}) {
  return (
    <section className="profile-field">
      <div className="profile-field-heading">
        <div>
          <span className="profile-field-label">{label}</span>
          {!editing && <p className="profile-field-value">{value}</p>}
        </div>
        {!editing && onEdit && (
          <button
            type="button"
            className="icon-button"
            aria-label={`Edit ${label === "Name (optional)" ? "name" : label.toLowerCase()}`}
            disabled={disabled}
            onClick={onEdit}
          >
            <Pencil size={16} />
          </button>
        )}
      </div>
      {editing && children}
    </section>
  );
}
