/** @file InterviewHub.tsx @description Gated interview hosting and resumable session discovery. @module interviews */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { InterviewSnapshot, InterviewQuestionInput } from "@quorem/contracts";
import { GlobalNav } from "../navigation/GlobalNav";
import { useSession } from "../auth/session";
import { useTheme } from "../editor/useTheme";
import { interviewRequest } from "./api";
import { QuestionSetup } from "./QuestionSetup";
import { useErrorNotification } from "../../ui/Notifications";
import "../../styles/workspace.css";
import "./interviews.css";

/** Presents existing memberships even when host rollout access has been revoked. */
export function InterviewHub() {
  const account = useSession();
  const theme = useTheme();
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
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
      window.location.assign(`/interview/${session.id}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not create interview.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="app-root interview-app">
      <GlobalNav theme={theme.preference} onThemeChange={theme.setPreference} />
      <main className="interview-hub">
        <div className="interview-heading">
          <h1>Interviews</h1>
          {account.data?.capabilities?.interviews && (
            <button className="button button-primary" onClick={() => setCreating(!creating)}>
              {creating ? "Cancel" : "New interview"}
            </button>
          )}
        </div>
        {!account.isPending && !account.data ? (
          <p>
            <a className="text-link" href="/login?returnTo=%2Finterviews">
              Sign in
            </a>{" "}
            to host or return to an interview. Guests can open their invitation directly.
          </p>
        ) : (
          <>
            {creating && (
              <QuestionSetup
                onSubmit={(question, title) => void create(question, title)}
                busy={busy}
              />
            )}
            {!creating && (
              <div className="interview-list">
                {sessions.isPending ? (
                  <p role="status">Loading interviews…</p>
                ) : sessions.isError ? (
                  <p role="alert">
                    Could not load interviews.{" "}
                    <button className="quiet-button" onClick={() => void sessions.refetch()}>
                      Retry
                    </button>
                  </p>
                ) : sessions.data?.length ? (
                  sessions.data.map((session) => (
                    <a key={session.id} href={`/interview/${session.id}`}>
                      <span>{session.title}</span>
                      <span>
                        {session.state === "closed"
                          ? "Closed"
                          : session.role === "interviewer"
                            ? "Interviewer"
                            : "Interviewee"}
                      </span>
                    </a>
                  ))
                ) : (
                  <p>
                    No interviews yet.{" "}
                    {account.data?.capabilities?.interviews
                      ? "Create one or open an invitation."
                      : "Open an invitation to join. Hosting is not enabled for this account."}
                  </p>
                )}
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}
