import { useErrorNotification } from "../../ui/Notifications";
import { Pencil, LoaderCircle, X } from "lucide-react";
import { Tooltip } from "../../ui/Tooltip";
import { useId, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { authErrorMessage } from "../auth/errors";
import {
  useProfile,
  uploadProfilePhoto,
  removeProfilePhoto,
  updateProfileColor,
  photoTypes,
} from "../auth/profile";
import { ProfileEditor } from "../auth/ProfileEditor";
import { PasskeySettings } from "../auth/PasskeySettings";
import { AccountAvatar } from "../navigation/AccountAvatar";
import { participantColor, participantColors } from "../collaboration/participantColor";
import { resetToken, fetchSession } from "../auth/session";

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
  const [editingColor, setEditingColor] = useState(false);
  const colorOptionsId = useId();
  const [error, setError] = useState("");
  useErrorNotification(error);
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
  async function changeColor(color: number) {
    setBusy(true);
    setError("");
    try {
      const updated = await updateProfileColor(color);
      client.setQueryData(["account-profile", userId], updated);
      resetToken();
      await fetchSession();
    } catch (cause) {
      setError(authErrorMessage(cause, "Color update unavailable. Try again."));
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
                  color={participantColor(userId, account.color)}
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
        <div>
          <ProfileEditor key={section} profile={account} userId={userId} section={section} />
        </div>
        {section === "profile" && (
          <section className="settings-profile-color">
            <div className="profile-field-heading">
              <div className="profile-color-current">
                <span className="profile-field-label">Profile color</span>
                <span
                  className="profile-color-swatch"
                  style={{ backgroundColor: participantColor(userId, account.color) }}
                  aria-hidden="true"
                />
              </div>
              <Tooltip content={editingColor ? "Close color picker" : "Edit profile color"}>
                <button
                  className="icon-button"
                  type="button"
                  aria-label={editingColor ? "Close color picker" : "Edit profile color"}
                  aria-expanded={editingColor}
                  aria-controls={colorOptionsId}
                  disabled={busy}
                  onClick={() => setEditingColor((value) => !value)}
                >
                  {editingColor ? <X size={16} /> : <Pencil size={16} />}
                </button>
              </Tooltip>
            </div>
            <div
              id={colorOptionsId}
              className="profile-color-reveal"
              data-open={editingColor}
              aria-hidden={!editingColor}
              inert={!editingColor}
            >
              <fieldset className="profile-colors" disabled={busy}>
                <legend className="sr-only">Profile color</legend>
                <div className="profile-color-options">
                  {participantColors.map((color, index) => (
                    <button
                      key={color}
                      type="button"
                      aria-label={`Color ${index + 1}`}
                      aria-pressed={color === participantColor(userId, account.color)}
                      title={`Color ${index + 1}`}
                      onClick={() => void changeColor(index + 1)}
                      style={{ backgroundColor: color }}
                    />
                  ))}
                </div>
              </fieldset>
            </div>
          </section>
        )}
      </div>
      {section === "security" && (
        <div className="settings-security-passkeys">
          <PasskeySettings />
        </div>
      )}
    </>
  );
}
