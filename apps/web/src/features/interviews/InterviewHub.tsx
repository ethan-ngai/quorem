import { LoadingScreen } from "../../ui/LoadingScreen";
import { Link } from "@tanstack/react-router";
/** @file InterviewHub.tsx @description Gated interview hosting and resumable session discovery. @module interviews */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { InterviewSnapshot, InterviewQuestionInput } from "@quorem/contracts";
import { GlobalNav } from "../navigation/GlobalNav";
import { useSession } from "../auth/session";
import { useTheme } from "../editor/useTheme";
import { interviewRequest } from "./api";
import { InterviewInvitationLinks } from "./InterviewInvitations";
import { QuestionSetup } from "./QuestionSetup";
import { useErrorNotification } from "../../ui/Notifications";
import "../../styles/workspace.css";
import { CatalogLayout, CatalogTable } from "../practice/CatalogLayout";
import { Trash2, Square } from "lucide-react";
import { Tooltip } from "../editor/components/Tooltip";
import { InterviewLifecycleDialog } from "./InterviewLifecycleDialog";
import { SessionDialog } from "../../ui/SessionDialog";

/** Presents existing memberships even when host rollout access has been revoked. */
export function InterviewHub() {
  const account = useSession();
  const theme = useTheme();
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState<InterviewSnapshot>();
  const [busy, setBusy] = useState(false);
  const [lifecycle, setLifecycle] = useState<{
    session: InterviewSnapshot;
    action: "end" | "delete";
  }>();
  const [error, setError] = useState<string>();
  useErrorNotification(error);
  const sessions = useQuery({
    queryKey: ["interviews", account.data?.user.id],
    queryFn: () => interviewRequest<InterviewSnapshot[]>("/v1/interviews"),
    enabled: !!account.data,
    refetchInterval: 10000,
  });
  async function create(question: InterviewQuestionInput, title: string) {
    setBusy(true);
    setError(undefined);
    try {
      const session = await interviewRequest<InterviewSnapshot>(
        "/v1/interviews",
        "POST",
        { title, question },
        crypto.randomUUID(),
      );
      setCreated(session);
      await sessions.refetch();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not create interview.");
    } finally {
      setBusy(false);
    }
  }
  const hosting =
    sessions.data?.filter(
      (session) => session.hostId === account.data?.user.id && session.state === "active",
    ).length ?? 0;
  const atLimit = hosting >= (account.data?.capabilities?.interviewConcurrency ?? 1);
  async function applyLifecycle() {
    if (!lifecycle) return;
    setBusy(true);
    setError(undefined);
    try {
      const { session, action } = lifecycle;
      await interviewRequest(
        `/v1/interviews/${session.id}${action === "end" ? "/close" : ""}`,
        action === "end" ? "POST" : "DELETE",
        undefined,
        crypto.randomUUID(),
      );
      await sessions.refetch();
      setLifecycle(action === "end" ? { session, action: "delete" } : undefined);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not update interview.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="practice-page">
      <GlobalNav theme={theme.preference} onThemeChange={theme.setPreference} />
      <CatalogLayout
        title="Interviews"
        description="Collaborate in a shared coding workspace."
        actions={
          account.data?.capabilities?.interviews && (
            <button
              className="button button-primary"
              disabled={sessions.isPending || atLimit}
              title={atLimit ? "End your active interview before hosting another" : undefined}
              onClick={() => {
                setCreated(undefined);
                setCreating(true);
              }}
            >
              New interview
            </button>
          )
        }
      >
        {!account.isPending && !account.data ? (
          <div className="practice-state">
            <p>
              <a className="text-link" href="/login?returnTo=%2Finterviews">
                Sign in
              </a>{" "}
              to host or return to an interview. Guests can open their invitation directly.
            </p>
          </div>
        ) : (
          <section
            className="practice-catalog"
            aria-label="Interviews"
            aria-busy={sessions.isFetching}
          >
            {sessions.isPending ? (
              <LoadingScreen inline label="Loading interviews…" />
            ) : sessions.isError ? (
              <div className="practice-state" role="alert">
                <p>Could not load interviews.</p>
                <button className="practice-retry" onClick={() => void sessions.refetch()}>
                  Retry
                </button>
              </div>
            ) : (
              <>
                <CatalogTable
                  label="Interviews"
                  heading={
                    <tr>
                      <th scope="col">Interview</th>
                      <th scope="col">Status</th>
                      <th scope="col">
                        <span className="sr-only">Actions</span>
                      </th>
                    </tr>
                  }
                >
                  {sessions.data?.map((session) => (
                    <tr
                      key={session.id}
                      onClick={(event) => {
                        if (!(event.target as Element).closest("a, button"))
                          window.location.assign(`/interview/${session.id}`);
                      }}
                    >
                      <td>
                        <Link to="/interview/$id" params={{ id: session.id }}>
                          {session.title}
                        </Link>
                      </td>
                      <td>
                        {session.state === "closed"
                          ? "Closed"
                          : session.role === "interviewer"
                            ? "Interviewer"
                            : "Interviewee"}
                      </td>
                      <td>
                        {session.hostId === account.data?.user.id && (
                          <Tooltip
                            content={
                              session.state === "closed" ? "Delete interview" : "End interview"
                            }
                          >
                            <button
                              className="icon-button destructive-icon"
                              aria-label={`${session.state === "closed" ? "Delete" : "End"} ${session.title}`}
                              disabled={busy}
                              onClick={() =>
                                setLifecycle({
                                  session,
                                  action: session.state === "closed" ? "delete" : "end",
                                })
                              }
                            >
                              {session.state === "closed" ? (
                                <Trash2 size={16} />
                              ) : (
                                <Square size={16} />
                              )}
                            </button>
                          </Tooltip>
                        )}
                      </td>
                    </tr>
                  ))}
                </CatalogTable>
                {!sessions.data?.length && (
                  <div className="practice-state">
                    <h2>No interviews yet</h2>
                    <p>
                      {account.data?.capabilities?.interviews
                        ? "Create one or open an invitation."
                        : "Open an invitation to join. Hosting is not enabled for this account."}
                    </p>
                  </div>
                )}
              </>
            )}
          </section>
        )}
      </CatalogLayout>
      <InterviewLifecycleDialog
        action={lifecycle?.action}
        busy={busy}
        onClose={() => setLifecycle(undefined)}
        onConfirm={() => void applyLifecycle()}
      />
      <SessionDialog
        open={creating}
        onOpenChange={setCreating}
        title={created ? "Invite people" : "Create interview"}
        description={created ? created.title : "Choose a question or add your own code and tests."}
        pending={busy}
        className="match-creation-dialog"
      >
        {created ? (
          <>
            <InterviewInvitationLinks
              title={created.title}
              invites={created.invites ?? { interviewee: created.invitePath }}
            />
            <footer className="competitive-dialog-actions">
              <Link
                className="button button-primary"
                to="/interview/$id"
                params={{ id: created.id }}
              >
                Open workspace
              </Link>
            </footer>
          </>
        ) : (
          <QuestionSetup onSubmit={(question, title) => void create(question, title)} busy={busy} />
        )}
      </SessionDialog>
    </div>
  );
}
