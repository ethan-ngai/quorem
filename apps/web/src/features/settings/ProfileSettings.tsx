import { Pencil, LoaderCircle } from "lucide-react";
import { Tooltip } from "../editor/components/Tooltip";
import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { authErrorMessage } from "../auth/errors";
import { useProfile, uploadProfilePhoto, removeProfilePhoto, photoTypes } from "../auth/profile";
import { ProfileEditor } from "../auth/ProfileEditor";
import { PasskeySettings } from "../auth/PasskeySettings";
import { AccountAvatar } from "../navigation/AccountAvatar";

export function ProfileSettings({
  userId,
  section,
}: {
  userId: string;
  section: "profile" | "security";
}) {
  const photoInput = useRef<HTMLInputElement>(null);
  const profile = useProfile(userId);
  const client = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function changePhoto(file?: File) {
    setBusy(true);
    setError("");
    try {
      const updated = file ? await uploadProfilePhoto(file) : await removeProfilePhoto();
      client.setQueryData(["account-profile", userId], updated);
    } catch (cause) {
      setError(authErrorMessage(cause, "Photo update unavailable. Try again."));
    } finally {
      setBusy(false);
    }
  }
  if (profile.isPending) return <p role="status">Loading account…</p>;
  if (!profile.data)
    return (
      <p role="alert">
        Account unavailable.{" "}
        <button className="quiet-button" onClick={() => void profile.refetch()}>
          Retry
        </button>
      </p>
    );
  const account = profile.data;
  return (
    <>
      <div className={section === "profile" ? "settings-profile-identity" : undefined}>
        {section === "profile" && (
          <div className="account-photo-editor">
            <Tooltip content="Change profile photo · JPEG, PNG or WebP · up to 5 MB and 16 megapixels.">
              <button
                className="profile-photo-trigger"
                aria-label="Change profile photo"
                aria-busy={busy}
                disabled={busy}
                onClick={() => photoInput.current?.click()}
              >
                <AccountAvatar
                  key={account.image || "initials"}
                  name={account.name || account.username || "Account"}
                  username={account.username}
                  image={account.image}
                  large
                />
                <span className="profile-photo-pencil" aria-hidden="true">
                  {busy ? (
                    <LoaderCircle className="settings-spinner" size={12} />
                  ) : (
                    <Pencil size={12} />
                  )}
                </span>
              </button>
            </Tooltip>
            <input
              ref={photoInput}
              className="sr-only"
              tabIndex={-1}
              type="file"
              aria-label="Choose profile photo"
              accept={photoTypes.join(",")}
              disabled={busy}
              onChange={(event) => {
                const file = event.currentTarget.files?.[0];
                if (file) void changePhoto(file);
                event.currentTarget.value = "";
              }}
            />
            <div>
              {account.image && (
                <button className="quiet-button" disabled={busy} onClick={() => void changePhoto()}>
                  Remove photo
                </button>
              )}
            </div>
          </div>
        )}
        <ProfileEditor key={section} profile={account} userId={userId} section={section} />
      </div>
      {section === "security" && (
        <div className="settings-security-passkeys">
          <PasskeySettings />
        </div>
      )}
      {error && (
        <p className="account-error settings-feedback" role="alert">
          {error}
        </p>
      )}
    </>
  );
}
