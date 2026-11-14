/** @file PasskeySettings.tsx @description Authenticated passkey enrollment and removal. @module auth */
import { LoadingButton } from "../../ui/LoadingButton";
import { AnimatedRows } from "../../ui/AnimatedRows";
import { useErrorNotification } from "../../ui/Notifications";
import { authErrorMessage } from "./errors";
import { useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Fingerprint } from "lucide-react";
import { addPasskey, deletePasskey, fetchAuthCapabilities, listPasskeys } from "./capabilities";
import { LoadingIndicator } from "../../ui/Spinner";

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
  const add = useRef<HTMLButtonElement>(null);
  const [operation, setOperation] = useState<string>();
  const busy = operation !== undefined;
  const [error, setError] = useState("");
  useErrorNotification(error);
  async function update(operation: string, action: () => Promise<unknown>) {
    setOperation(operation);
    setError("");
    try {
      await action();
      await keys.refetch();
    } catch (cause) {
      setError(authErrorMessage(cause, "Passkey update unavailable. Try again."));
    } finally {
      setOperation(undefined);
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
        <LoadingIndicator label="Loading sign-in methods…" />
      ) : capabilities.isError ? (
        <p role="alert">
          Sign-in methods unavailable.{" "}
          <LoadingButton
            className="quiet-button"
            onClick={() => void capabilities.refetch()}
            pending={capabilities.isFetching}
          >
            Retry
          </LoadingButton>
        </p>
      ) : !capabilities.data?.passkey ? (
        <p>Passkeys aren’t available on this server.</p>
      ) : (
        <>
          {keys.isPending ? (
            <LoadingIndicator label="Loading passkeys…" />
          ) : keys.isError ? (
            <p role="alert">
              Passkeys unavailable.{" "}
              <LoadingButton
                className="quiet-button"
                onClick={() => void keys.refetch()}
                pending={keys.isFetching}
              >
                Retry
              </LoadingButton>
            </p>
          ) : (
            <AnimatedRows
              as="ul"
              className="passkey-list"
              items={keys.data ?? []}
              getKey={(key) => key.id}
              focusFallback={add}
              renderRow={(key) => (
                <>
                  <span>{key.name || "Passkey"}</span>
                  <LoadingButton
                    className="quiet-button"
                    disabled={busy}
                    onClick={() => void update(key.id, () => deletePasskey(key.id))}
                    aria-label={`Remove ${key.name || "passkey"}`}
                    pending={operation === key.id}
                  >
                    Remove
                  </LoadingButton>
                </>
              )}
            />
          )}
          {!keys.isPending && !keys.isError && !keys.data?.length && (
            <p className="motion-reveal">No passkeys added.</p>
          )}
          <LoadingButton
            className="button button-secondary"
            ref={add}
            disabled={busy || typeof PublicKeyCredential === "undefined"}
            onClick={() => void update("add", () => addPasskey("Quorem"))}
            pending={operation === "add"}
          >
            Add a passkey
          </LoadingButton>
          {typeof PublicKeyCredential === "undefined" ? (
            <p>Use a browser that supports passkeys.</p>
          ) : null}
        </>
      )}
    </section>
  );
}
