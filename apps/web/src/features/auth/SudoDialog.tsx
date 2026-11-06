/** @file SudoDialog.tsx @description Reauthentication through enabled account methods. @module auth */
import { sudoLifetimeSeconds } from "@quorem/contracts/auth-policy";
import { useState, useSyncExternalStore } from "react";
import { KeyRound, Fingerprint, Mail } from "lucide-react";
import { authInputConstraints } from "./inputConstraints";
import { TextInput } from "../../ui/TextControl";
import { SessionDialog } from "../../ui/SessionDialog";
import { SegmentedControl } from "../../ui/SegmentedControl";
import { PersistentNotice } from "../../ui/PersistentNotice";
import { verifyWithPasskey, supportsPasskeys } from "./capabilities";
import { authErrorMessage } from "./errors";
import {
  cancelSudo,
  completeSudo,
  sudoRequest,
  sudoSnapshot,
  subscribeSudo,
  type SudoStatus,
} from "./sudo";
import "./sudo.css";

type Method = "password" | "passkey" | "email";
export function SudoDialog() {
  const prompt = useSyncExternalStore(subscribeSudo, sudoSnapshot, () => undefined);
  return prompt ? <SudoPrompt status={prompt.status} /> : null;
}
function SudoPrompt({ status }: { status: SudoStatus }) {
  const methods = [
    ...(status.methods.password
      ? [{ value: "password" as const, label: "Password", icon: <KeyRound size={16} /> }]
      : []),
    ...(status.methods.passkey && supportsPasskeys()
      ? [{ value: "passkey" as const, label: "Passkey", icon: <Fingerprint size={16} /> }]
      : []),
    ...(status.methods.email
      ? [{ value: "email" as const, label: "Email code", icon: <Mail size={16} /> }]
      : []),
  ];
  const [method, setMethod] = useState<Method>(methods[0]?.value ?? "password");
  const [value, setValue] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(resend = false) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      if (method === "email" && (!sent || resend)) {
        await sudoRequest("send-code", {});
        setSent(true);
        setValue("");
      } else {
        if (method === "passkey") await verifyWithPasskey();
        else
          await sudoRequest(
            method === "password" ? "password" : "email-code",
            method === "password" ? { password: value } : { code: value },
          );
        setValue("");
        await completeSudo();
      }
    } catch (cause) {
      setError(authErrorMessage(cause, "Verification unavailable. Try again."));
    } finally {
      setBusy(false);
    }
  }
  return (
    <SessionDialog
      open
      pending={busy}
      onOpenChange={(open) => {
        if (!open) cancelSudo();
      }}
      title="Confirm your identity"
      description={`Sudo mode lasts ${sudoLifetimeSeconds / 60} minutes.`}
    >
      <form
        className="sudo-form"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        {methods.length > 1 && (
          <SegmentedControl
            label="Verification method"
            value={method}
            options={methods}
            disabled={busy}
            onChange={(next) => {
              setMethod(next);
              setValue("");
              setError("");
            }}
          />
        )}
        {!methods.length ? (
          <p>No verification method is available. Contact support.</p>
        ) : method === "password" ? (
          <label className="sudo-field">
            Password
            <TextInput
              constraint={authInputConstraints.password}
              type="password"
              autoComplete="current-password"
              value={value}
              onChange={(event) => setValue(event.target.value)}
              maxLength={128}
              disabled={busy}
              required
            />
          </label>
        ) : method === "email" && sent ? (
          <label className="sudo-field">
            Code sent to your verified email
            <TextInput
              constraint={authInputConstraints.code}
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]{6}"
              value={value}
              onChange={(event) => setValue(event.target.value)}
              maxLength={6}
              disabled={busy}
              required
            />
          </label>
        ) : null}
        <footer className="competitive-dialog-actions">
          <PersistentNotice label="Verification needs attention" message={error} />
          {method === "email" && sent && (
            <button
              type="button"
              className="button button-secondary"
              disabled={busy}
              onClick={() => void submit(true)}
            >
              Resend code
            </button>
          )}
          <button
            type="button"
            className="button button-secondary"
            disabled={busy}
            onClick={cancelSudo}
          >
            Cancel
          </button>
          <button
            type="submit"
            className="button button-primary"
            disabled={busy || !methods.length}
          >
            {busy
              ? "Verifying…"
              : method === "email" && !sent
                ? "Send code"
                : method === "passkey"
                  ? "Use passkey"
                  : "Confirm"}
          </button>
        </footer>
      </form>
    </SessionDialog>
  );
}
