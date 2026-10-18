import { useState } from "react";
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
      {section === "profile" && (
        <div className="account-photo-editor">
          <AccountAvatar
            name={account.name || account.username || "Account"}
            username={account.username}
            image={account.image}
            large
          />
          <div>
            <label
              className={`button button-secondary account-upload${busy ? " is-disabled" : ""}`}
            >
              {busy ? "Updating…" : "Upload photo"}
              <input
                type="file"
                aria-label="Upload profile photo"
                accept={photoTypes.join(",")}
                disabled={busy}
                onChange={(event) => {
                  const file = event.currentTarget.files?.[0];
                  if (file) void changePhoto(file);
                  event.currentTarget.value = "";
                }}
              />
            </label>
            {account.image && (
              <button className="quiet-button" disabled={busy} onClick={() => void changePhoto()}>
                Remove photo
              </button>
            )}
            <p>JPEG, PNG or WebP · up to 5 MB</p>
          </div>
        </div>
      )}
      <ProfileEditor key={section} profile={account} userId={userId} section={section} />
      {section === "security" && (
        <div className="settings-security-passkeys">
          <PasskeySettings />
        </div>
      )}
      {error && (
        <p className="account-error" role="alert">
          {error}
        </p>
      )}
    </>
  );
}
