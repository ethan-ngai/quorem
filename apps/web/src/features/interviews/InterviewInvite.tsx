/** @file InterviewInvite.tsx @description Account and guest admission through scoped interview invitations. @module interviews */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { InterviewPreview, InterviewSnapshot } from "@quorem/contracts";
import { GlobalNav } from "../navigation/GlobalNav";
import { useSession } from "../auth/session";
import { useTheme } from "../editor/useTheme";
import { interviewRequest } from "./api";
import "../../styles/workspace.css";
import "./interviews.css";

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
    <div className="app-root interview-app">
      <GlobalNav theme={theme.preference} onThemeChange={theme.setPreference} />
      <main className="interview-invite">
        {preview.isPending ? (
          <p role="status">Opening invitation…</p>
        ) : preview.isError ? (
          <>
            <h1>Invitation unavailable</h1>
            <p>Ask an interviewer for a current invitation.</p>
            <button className="quiet-button" onClick={() => void preview.refetch()}>
              Try again
            </button>
          </>
        ) : (
          <>
            <h1>{preview.data.title}</h1>
            <p>Collaborate in one shared coding workspace.</p>
            {preview.data.state === "closed" ? (
              <p>This interview has ended.</p>
            ) : (
              <form
                className="interview-setup"
                onSubmit={(event) => {
                  event.preventDefault();
                  void join();
                }}
              >
                {!account.data && (
                  <label>
                    <span>Your name</span>
                    <input
                      required
                      maxLength={80}
                      value={name}
                      onChange={(event) => setName(event.target.value)}
                      autoComplete="name"
                    />
                  </label>
                )}
                {error && (
                  <p className="interview-error" role="alert">
                    {error}
                  </p>
                )}
                <button className="button button-primary" disabled={busy || account.isPending}>
                  {busy ? "Joining…" : "Join interview"}
                </button>
              </form>
            )}
          </>
        )}
      </main>
    </div>
  );
}
