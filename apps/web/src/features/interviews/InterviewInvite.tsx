/** @file InterviewInvite.tsx @description Account and guest admission through scoped interview invitations. @module interviews */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { InterviewPreview, InterviewSnapshot } from "@quorem/contracts";
import { GlobalNav } from "../navigation/GlobalNav";
import { useSession } from "../auth/session";
import { useTheme } from "../editor/useTheme";
import { interviewRequest } from "./api";
import "../../styles/workspace.css";
import { SessionDialog } from "../../ui/SessionDialog";
import { InvitationLayout } from "../../ui/InvitationLayout";
import { WorkspaceRecovery } from "../../ui/WorkspaceRecovery";
import { useErrorNotification } from "../../ui/Notifications";

/** Joining as a guest creates only an interview-scoped credential. */
export function InterviewInvite({ token }: { token: string }) {
  const account = useSession();
  const theme = useTheme();
  const preview = useQuery({
    queryKey: ["interview-invite", token],
    queryFn: () =>
      interviewRequest<InterviewPreview>(`/v1/interview-invites/${encodeURIComponent(token)}`),
    retry: false,
  });
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [dismissed, setDismissed] = useState(false);
  useErrorNotification(error);
  async function join() {
    setBusy(true);
    setError(undefined);
    try {
      const session = await interviewRequest<InterviewSnapshot>(
        `/v1/interview-invites/${encodeURIComponent(token)}/join`,
        "POST",
        { name: name.trim() || undefined },
        crypto.randomUUID(),
      );
      window.location.assign(`/interview/${session.id}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not join interview.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <InvitationLayout
      navigation={<GlobalNav theme={theme.preference} onThemeChange={theme.setPreference} />}
    >
      {preview.isPending || preview.isError ? (
        <WorkspaceRecovery
          failed={preview.isError}
          title={preview.isError ? "Invitation unavailable" : "Opening interview"}
          message={
            preview.isError
              ? "Ask an interviewer for a current invitation, or retry."
              : "Loading the shared workspace…"
          }
          onRetry={() => preview.refetch()}
        />
      ) : (
        <>
          <div className="competitive-lobby-heading">
            <h1>{preview.data.title}</h1>
          </div>
          <dl className="competitive-lobby-summary">
            <div>
              <dt>Role</dt>
              <dd>{preview.data.role === "interviewer" ? "Interviewer" : "Interviewee"}</dd>
            </div>
            <div>
              <dt>Status</dt>
              <dd>{preview.data.state === "closed" ? "Ended" : "Open"}</dd>
            </div>
          </dl>
          <footer className="competitive-lobby-actions">
            <button
              id="interview-join"
              className="button button-primary"
              disabled={account.isPending || preview.data.state === "closed"}
              onClick={() => setDismissed(false)}
            >
              Join interview
            </button>
          </footer>
          <SessionDialog
            open={!dismissed && !account.isPending && preview.data.state !== "closed"}
            onOpenChange={(open) => setDismissed(!open)}
            pending={busy}
            title="Join this interview?"
            description={
              account.data
                ? `Join as ${account.data.user.displayName} · ${preview.data.role === "interviewer" ? "Interviewer" : "Interviewee"}.`
                : "Choose a display name to continue as a guest."
            }
            returnFocus={() => document.getElementById("interview-join")?.focus()}
          >
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void join();
              }}
            >
              {!account.data && (
                <label className="guest-name-field">
                  Display name
                  <input
                    required
                    maxLength={80}
                    autoComplete="nickname"
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    disabled={busy}
                  />
                </label>
              )}
              <footer className="competitive-dialog-actions">
                <button
                  type="button"
                  className="button button-secondary"
                  disabled={busy}
                  onClick={() => setDismissed(true)}
                >
                  View interview
                </button>
                <button className="button button-primary" disabled={busy || account.isPending}>
                  {busy ? "Joining…" : "Join interview"}
                </button>
              </footer>
            </form>
          </SessionDialog>
        </>
      )}
    </InvitationLayout>
  );
}
