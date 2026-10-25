import { toast } from "sonner";
import { PasswordResetSetting } from "./PasswordResetSetting";
import { authErrorMessage } from "./errors";
import { Pencil, Check, X, Send } from "lucide-react";
import * as Popover from "@radix-ui/react-popover";
import { Tooltip } from "../editor/components/Tooltip";
import { type ReactNode, useState, useEffect, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  emailInputSchema,
  emailSchema,
  optionalNameSchema,
  usernameInputSchema,
  usernameSchema,
} from "@quorem/contracts/auth";
import { fetchAuthCapabilities } from "./capabilities";
import { AccountRateLimitError, updateAccount, requestEmailChange } from "./account";
import { fetchProfile, type AccountProfile } from "./profile";
import { resetToken } from "./session";
import { UsernameRules } from "./UsernameRules";
import { useCooldown } from "../../ui/useCooldown";
import "./profile-editor.css";

export function ProfileEditor({
  profile,
  userId,
  section = "profile",
}: {
  profile: AccountProfile;
  userId: string;
  section?: "profile" | "security";
}) {
  const [editing, setEditing] = useState<"name" | "username" | "email" | "password" | null>(null);
  const [name, setName] = useState(profile.name);
  const [username, setUsername] = useState(profile.username ?? "");
  const [email, setEmail] = useState(profile.email);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const emailCooldown = useCooldown();
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
      toast.error(authErrorMessage(cause, "Account update unavailable."));
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
    <FieldAction label="Cancel editing" disabled={busy} onClick={() => edit(null)}>
      <X size={16} />
    </FieldAction>
  );
  return (
    <div className="profile-editor">
      {section === "profile" && (
        <>
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
                <FieldAction label="Save name" type="submit" disabled={busy}>
                  <Check size={16} />
                </FieldAction>
                {cancel}
              </div>
            </form>
          </ProfileField>
          {localCredentials && (
            <ProfileField
              label="Username"
              value={profile.username ?? "Not set"}
              hint={<UsernameRules id="profile-username-rules" />}
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
                <div className="profile-edit-actions">
                  <FieldAction label="Save username" type="submit" disabled={busy}>
                    <Check size={16} />
                  </FieldAction>
                  {cancel}
                </div>
              </form>
            </ProfileField>
          )}
        </>
      )}
      {section === "security" && (
        <>
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
                <FieldAction
                  type="submit"
                  label={
                    emailCooldown.remaining
                      ? `Retry in ${emailCooldown.remaining}s`
                      : "Verify email change"
                  }
                  disabled={busy || email === profile.email || emailCooldown.remaining > 0}
                >
                  <Send size={16} />
                </FieldAction>
                {cancel}
              </div>
            </form>
          </ProfileField>
          {capabilities.data?.registration && (
            <PasswordResetSetting email={profile.email} disabled={busy} onOpen={() => edit(null)} />
          )}
        </>
      )}
      {message && (
        <p className="settings-feedback" role="status">
          {message}
        </p>
      )}
      {error && (
        <p className="account-error settings-feedback" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

/** Keep the read-only value in flow so editing never changes row geometry. */
function ProfileField({
  label,
  value,
  editing,
  onEdit,
  disabled,
  children,
  hint,
}: {
  label: string;
  value: string;
  editing: boolean;
  onEdit?: () => void;
  disabled: boolean;
  children: ReactNode;
  hint?: ReactNode;
}) {
  return (
    <section className="profile-field">
      <Popover.Root open={editing && Boolean(hint)}>
        <Popover.Anchor asChild>
          <div className="profile-field-content" data-editing={editing}>
            <div className="profile-field-heading">
              <div>
                <span className="profile-field-label">{label}</span>
                <p className="profile-field-value" aria-hidden={editing || undefined}>
                  {value}
                </p>
              </div>
              {onEdit && (
                <span className="profile-pencil" inert={editing} aria-hidden={editing || undefined}>
                  <FieldAction
                    label={`Edit ${label === "Name (optional)" ? "name" : label.toLowerCase()}`}
                    disabled={disabled || editing}
                    onClick={onEdit}
                  >
                    <Pencil size={16} />
                  </FieldAction>
                </span>
              )}
            </div>
            <EditLayer open={editing}>{children}</EditLayer>
          </div>
        </Popover.Anchor>
        {hint && (
          <Popover.Portal>
            <Popover.Content
              className="nav-popover profile-field-hint"
              side="bottom"
              align="start"
              sideOffset={8}
              collisionPadding={8}
              onOpenAutoFocus={(event) => event.preventDefault()}
              onCloseAutoFocus={(event) => event.preventDefault()}
            >
              {hint}
            </Popover.Content>
          </Popover.Portal>
        )}
      </Popover.Root>
    </section>
  );
}

function FieldAction({
  label,
  children,
  disabled,
  type = "button",
  onClick,
}: {
  label: string;
  children: ReactNode;
  disabled: boolean;
  type?: "button" | "submit";
  onClick?: () => void;
}) {
  return (
    <Tooltip content={label}>
      <button
        className="icon-button"
        aria-label={label}
        title={disabled ? label : undefined}
        type={type}
        disabled={disabled}
        onClick={onClick}
      >
        {children}
      </button>
    </Tooltip>
  );
}

/** Keep the outgoing layer briefly for its fade; never leave hidden controls interactive. */
function EditLayer({ open, children }: { open: boolean; children: ReactNode }) {
  const [present, setPresent] = useState(open);
  useEffect(() => {
    if (open) {
      setPresent(true);
      return;
    }
    const timer = window.setTimeout(() => setPresent(false), 120);
    return () => window.clearTimeout(timer);
  }, [open]);
  return present || open ? (
    <div
      className="profile-edit-layer"
      data-state={open ? "open" : "closed"}
      inert={!open}
      aria-hidden={!open || undefined}
    >
      {children}
    </div>
  ) : null;
}
