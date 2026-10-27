import { useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Check, Link, Unlink } from "lucide-react";
import { SessionDialog } from "../../ui/SessionDialog";
import { Tooltip } from "../../ui/Tooltip";
import { SocialProviderIcon } from "./SocialProviderIcon";
import {
  fetchAuthCapabilities,
  socialProviders,
  socialProviderLabels as labels,
  type SocialProvider,
} from "./capabilities";
import { accountRequest, connectProvider, listAccounts, type ConnectedAccount } from "./account";
import { authErrorMessage } from "./errors";
import { useErrorNotification } from "../../ui/Notifications";

export function SocialAccounts({ userId }: { userId: string }) {
  const capabilities = useQuery({
    queryKey: ["auth-capabilities"],
    queryFn: fetchAuthCapabilities,
  });
  const accounts = useQuery({ queryKey: ["account-connections", userId], queryFn: listAccounts });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [disconnect, setDisconnect] = useState<{
    provider: SocialProvider;
    account: ConnectedAccount;
  } | null>(null);
  const cancelDisconnect = useRef<HTMLButtonElement>(null);
  useErrorNotification(error);
  async function update(provider: SocialProvider, account?: ConnectedAccount) {
    setBusy(true);
    setError("");
    try {
      if (account) {
        await accountRequest("unlink-account", { accountId: account.id });
        await accounts.refetch();
        setDisconnect(null);
      } else {
        await connectProvider(provider);
      }
    } catch (cause) {
      setError(authErrorMessage(cause, "Connection update unavailable."));
    } finally {
      setBusy(false);
    }
  }
  const providers = socialProviders.filter(
    (provider) =>
      capabilities.data?.providers.includes(provider) ||
      accounts.data?.some((account) => account.providerId === provider),
  );
  return (
    <section className="account-passkeys social-accounts" aria-label="Social accounts">
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
                <span className="social-account-label">
                  <SocialProviderIcon provider={provider} color />
                  <span>{labels[provider]}</span>
                  {connected.length > 0 && (
                    <Check className="social-account-check" size={16} aria-label="Connected" />
                  )}
                </span>
                {connected.length ? (
                  connected.map((account) => {
                    const lastMethod = accounts.data?.length === 1;
                    const label = `Disconnect ${labels[provider]}`;
                    const reason = "Add a password or another sign-in method before disconnecting.";
                    const button = (
                      <button
                        className="icon-button destructive-icon social-account-disconnect"
                        disabled={busy || lastMethod}
                        onClick={() => setDisconnect({ provider, account })}
                        aria-label={label}
                      >
                        <Unlink size={18} />
                      </button>
                    );
                    return lastMethod ? (
                      <Tooltip key={account.id} content={reason}>
                        <span
                          className="social-account-disabled-action"
                          tabIndex={0}
                          aria-label={`${label} unavailable. ${reason}`}
                        >
                          {button}
                        </span>
                      </Tooltip>
                    ) : (
                      <Tooltip key={account.id} content={label}>
                        {button}
                      </Tooltip>
                    );
                  })
                ) : (
                  <Tooltip content={`Connect ${labels[provider]}`}>
                    <button
                      className="icon-button"
                      disabled={busy || !capabilities.data?.providers.includes(provider)}
                      onClick={() => void update(provider)}
                      aria-label={`Connect ${labels[provider]}`}
                    >
                      <Link size={18} />
                    </button>
                  </Tooltip>
                )}
              </li>
            );
          })}
        </ul>
      ) : (
        <p>No social providers are available on this server.</p>
      )}
      <SessionDialog
        open={disconnect !== null}
        onOpenChange={(open) => {
          if (!open) setDisconnect(null);
        }}
        className="social-disconnect-dialog"
        overlayClassName="social-disconnect-backdrop"
        title={
          <>
            Disconnect
            {disconnect && (
              <span className="social-disconnect-provider">
                <SocialProviderIcon provider={disconnect.provider} size={18} color />
                {`${labels[disconnect.provider]}?`}
              </span>
            )}
          </>
        }
        description={`You won’t be able to sign in with ${disconnect ? labels[disconnect.provider] : "this account"} until you connect it again.`}
        pending={busy}
        initialFocus={cancelDisconnect}
      >
        <div className="competitive-dialog-actions">
          <button
            ref={cancelDisconnect}
            className="button button-secondary"
            disabled={busy}
            onClick={() => setDisconnect(null)}
          >
            Cancel
          </button>
          <button
            className="button button-danger"
            disabled={busy}
            onClick={() => {
              if (disconnect) void update(disconnect.provider, disconnect.account);
            }}
          >
            {busy ? "Disconnecting…" : "Disconnect"}
          </button>
        </div>
      </SessionDialog>
    </section>
  );
}
