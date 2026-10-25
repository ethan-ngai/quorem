import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "lucide-react";
import { fetchAuthCapabilities, type SocialProvider } from "./capabilities";
import { accountRequest, connectProvider, listAccounts, type ConnectedAccount } from "./account";
import { authErrorMessage } from "./errors";
import { useErrorNotification } from "../../ui/Notifications";

const labels = { google: "Google", apple: "Apple", github: "GitHub" };
export function SocialAccounts({ userId }: { userId: string }) {
  const capabilities = useQuery({
    queryKey: ["auth-capabilities"],
    queryFn: fetchAuthCapabilities,
  });
  const accounts = useQuery({ queryKey: ["account-connections", userId], queryFn: listAccounts });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useErrorNotification(error);
  async function update(provider: SocialProvider, account?: ConnectedAccount) {
    setBusy(true);
    setError("");
    try {
      if (account) {
        await accountRequest("unlink-account", { accountId: account.id });
        await accounts.refetch();
      } else {
        await connectProvider(provider);
      }
    } catch (cause) {
      setError(authErrorMessage(cause, "Connection update unavailable."));
    } finally {
      setBusy(false);
    }
  }
  const providers = Array.from(
    new Set([
      ...(capabilities.data?.providers ?? []),
      ...(accounts.data ?? [])
        .map((a) => a.providerId)
        .filter((id): id is SocialProvider => Object.hasOwn(labels, id)),
    ]),
  );
  return (
    <section className="account-passkeys" aria-label="Social accounts">
      <p>Connect another way to sign in to your account.</p>
      {accounts.isPending || capabilities.isPending ? (
        <p role="status">Loading connections…</p>
      ) : accounts.isError || capabilities.isError ? (
        <p role="alert">
          Connections unavailable.{" "}
          <button
            className="quiet-button"
            onClick={() => {
              void accounts.refetch();
              void capabilities.refetch();
            }}
          >
            Retry
          </button>
        </p>
      ) : providers.length ? (
        <ul>
          {providers.map((provider) => {
            const connected = accounts.data?.filter((a) => a.providerId === provider) ?? [];
            return (
              <li key={provider}>
                <span>
                  <Link size={16} /> {labels[provider]} ·{" "}
                  {connected.length ? "Connected" : "Not connected"}
                </span>
                {connected.length ? (
                  connected.map((account) => (
                    <button
                      key={account.id}
                      className="quiet-button"
                      disabled={busy || (accounts.data?.length ?? 0) < 2}
                      onClick={() => void update(provider, account)}
                      aria-label={`Disconnect ${labels[provider]}`}
                    >
                      Disconnect
                    </button>
                  ))
                ) : (
                  <button
                    className="quiet-button"
                    disabled={busy || !capabilities.data?.providers.includes(provider)}
                    onClick={() => void update(provider)}
                  >
                    Connect {labels[provider]}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      ) : (
        <p>No social providers are available on this server.</p>
      )}
      {accounts.data?.length === 1 && providers.length > 0 && (
        <p>Add a password or another connection before disconnecting your only sign-in method.</p>
      )}
    </section>
  );
}
