/** @file PasskeySettings.tsx @description Authenticated passkey enrollment and removal. @module auth */
import { useErrorNotification } from "../../ui/Notifications";
import { authErrorMessage } from "./errors";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Fingerprint } from "lucide-react";
import { addPasskey, deletePasskey, fetchAuthCapabilities, listPasskeys } from "./capabilities";

export function PasskeySettings() {
  const capabilities = useQuery({
    queryKey: ["auth-capabilities"],
    queryFn: fetchAuthCapabilities,
    retry: false,
  });
  const keys = useQuery({
    queryKey: ["account-passkeys"],
    queryFn: listPasskeys,
    enabled: capabilities.data?.passkey === true,
    retry: false,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useErrorNotification(error);
  async function update(action: () => Promise<unknown>) {
    setBusy(true);
    setError("");
    try {
      await action();
      await keys.refetch();
    } catch (cause) {
      setError(authErrorMessage(cause, "Passkey update unavailable. Try again."));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="account-passkeys" aria-labelledby="passkeys-title">
      <h3 id="passkeys-title">
        <Fingerprint size={18} />
        Passkeys
      </h3>
      <p>Sign in using your fingerprint, face or device lock.</p>
      {capabilities.isPending ? (
        <p role="status">Loading sign-in methods…</p>
      ) : capabilities.isError ? (
        <p role="alert">
          Sign-in methods unavailable.{" "}
          <button className="quiet-button" onClick={() => void capabilities.refetch()}>
            Retry
          </button>
        </p>
      ) : !capabilities.data?.passkey ? (
        <p>Passkeys aren’t available on this server.</p>
      ) : (
        <>
          {keys.isPending ? (
            <p role="status">Loading passkeys…</p>
          ) : keys.isError ? (
            <p role="alert">
              Passkeys unavailable.{" "}
              <button className="quiet-button" onClick={() => void keys.refetch()}>
                Retry
              </button>
            </p>
          ) : keys.data?.length ? (
            <ul>
              {keys.data.map((key) => (
                <li key={key.id}>
                  <span>{key.name || "Passkey"}</span>
                  <button
                    className="quiet-button"
                    disabled={busy}
                    onClick={() => void update(() => deletePasskey(key.id))}
                    aria-label={`Remove ${key.name || "passkey"}`}
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p>No passkeys added.</p>
          )}
          <button
            className="button"
            aria-busy={busy}
            disabled={busy || typeof PublicKeyCredential === "undefined"}
            onClick={() => void update(() => addPasskey("Quorem"))}
          >
            Add a passkey
          </button>
          {typeof PublicKeyCredential === "undefined" ? (
            <p>Use a browser that supports passkeys.</p>
          ) : null}
        </>
      )}
    </section>
  );
}
