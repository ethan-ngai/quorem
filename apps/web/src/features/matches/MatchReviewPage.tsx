/** @file MatchReviewPage.tsx @description Read-only, participant-authorized latest-round review. @module matches */
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import type { DevelopmentIdentity, MatchReview } from "@quorem/contracts";
import { authenticatedFetch, useSession } from "../auth/session";
import { useTheme } from "../editor/useTheme";
import { useLocalEditorPreferences } from "../settings/useLocalEditorPreferences";
import { browserDraftScope, readBrowserDraft } from "../editor/recovery";
import type { EditorLanguage } from "../editor/editorLanguages";
import { GlobalNav } from "../navigation/GlobalNav";
import { WorkspaceLayout, type WorkspacePanel } from "../editor/components/WorkspaceLayout";
import { ProblemStatement } from "../editor/components/ProblemStatement";
import { WorkspaceTests } from "../editor/components/WorkspaceTests";
import { ReviewDiff } from "./ReviewDiff";
import { useActiveMatch } from "./useActiveMatch";
import { useParty } from "./party";
import { SelectField } from "../../ui/SelectField";
import { LanguageLogo } from "../../ui/LanguageLogo";
import { languageLabels } from "../editor/editorLanguages";
import { EditorialCode } from "../editor/components/EditorialCode";
import "./review.css";

class ReviewRequestError extends Error {
  constructor(readonly status: number) {
    super("Review unavailable");
  }
}

function editorLanguage(value: string | undefined): EditorLanguage | undefined {
  return value && Object.hasOwn(languageLabels, value) ? (value as EditorLanguage) : undefined;
}

export function MatchReviewPage({ matchId }: { matchId: string }) {
  const session = useSession();
  const identity = (session.data?.user.id ?? "anonymous") as DevelopmentIdentity;
  const { theme, preference, setPreference } = useTheme();
  const { editorSchemes } = useLocalEditorPreferences();
  const [panel, setPanel] = useState<WorkspacePanel>("problem");
  const [selected, setSelected] = useState("");
  const [compare, setCompare] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [diff, setDiff] = useState(false);
  const [now, setNow] = useState(Date.now);
  const party = useParty(identity, !!session.data);
  const currentMatchId = party.data?.party?.currentMatchId;
  const activeMatch = useActiveMatch(identity, !!currentMatchId && currentMatchId !== matchId);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  const review = useQuery({
    queryKey: ["match-review", identity, matchId],
    enabled: !!session.data,
    retry: false,
    gcTime: 0,
    refetchInterval: 20_000,
    queryFn: async () => {
      const response = await authenticatedFetch(
        new URL(
          `/v1/matches/${encodeURIComponent(matchId)}/review`,
          import.meta.env.VITE_API_BASE_URL ?? window.location.origin,
        ),
      );
      if (!response.ok) throw new ReviewRequestError(response.status);
      return (await response.json()) as MatchReview;
    },
  });
  const nav = <GlobalNav identity={identity} theme={preference} onThemeChange={setPreference} />;
  if (session.isPending || (!!session.data && review.isPending))
    return (
      <main className="match-page">
        {nav}
        <p role="status">Loading review…</p>
      </main>
    );
  if (!session.data)
    return (
      <main className="match-page">
        {nav}
        <section className="match-page-content">
          <h1>Sign in to review code</h1>
          <a className="button button-primary" href="/login">
            Sign in
          </a>
        </section>
      </main>
    );
  if (
    review.isError ||
    !review.data ||
    Date.parse(review.data.completedAt) + 86_400_000 <= now ||
    (currentMatchId && currentMatchId !== matchId && activeMatch.match?.id === currentMatchId)
  )
    return (
      <main className="match-page">
        {nav}
        <section className="match-page-content">
          <h1>Review unavailable</h1>
          {review.error instanceof ReviewRequestError && review.error.status === 401 ? (
            <>
              <p>Your session has expired. Sign in to continue.</p>
              <a
                className="button button-primary"
                href={`/login?returnTo=${encodeURIComponent(`/match/${matchId}/review`)}`}
              >
                Sign in
              </a>
            </>
          ) : review.isError &&
            (!(review.error instanceof ReviewRequestError) || review.error.status >= 500) ? (
            <>
              <p>Review is temporarily unavailable.</p>
              <button className="button button-secondary" onClick={() => void review.refetch()}>
                Try again
              </button>
            </>
          ) : (
            <p>This review may have expired or you may not have access.</p>
          )}
          <a href={`/match/${matchId}`}>Return to results</a>
        </section>
      </main>
    );
  const data = review.data;
  const own = data.participants.find((person) => person.own);
  const opponents = data.participants.filter((person) => !person.own);
  const other = opponents.find((person) => person.userId === selected) ?? opponents[0];
  const local = own?.workspace
    ? readBrowserDraft(
        identity,
        browserDraftScope({ ...own.workspace, kind: "match" }),
        data.problem.id,
      )
    : undefined;
  const ownSource = submitted ? own?.submission?.source : (local ?? own?.submission?.source);
  const ownLanguage = editorLanguage(
    submitted
      ? own?.submission?.language
      : local !== undefined
        ? own?.workspace?.language
        : own?.submission?.language,
  );
  const otherLanguage = editorLanguage(other?.submission?.language);
  const code = (
    label: string,
    source: string | undefined,
    language: EditorLanguage | undefined,
    accessibleLabel: string,
  ) => (
    <div className="review-code">
      <h3>
        {label}{" "}
        {language && <LanguageLogo language={language} tooltip={languageLabels[language]} />}
      </h3>
      {source !== undefined && language ? (
        <EditorialCode
          source={source}
          language={language}
          label={accessibleLabel}
          theme={theme}
          colorScheme={editorSchemes[theme]}
        />
      ) : (
        <p>No submission</p>
      )}
    </div>
  );
  return (
    <WorkspaceLayout
      navigation={nav}
      panel={panel}
      onPanelChange={setPanel}
      language={ownLanguage ?? "python"}
      header={
        <>
          <strong>Review code</strong> <a href={`/match/${matchId}`}>Return to results</a>
        </>
      }
      problem={<ProblemStatement problem={data.problem} />}
      editor={
        <>
          {!data.shareCodeAfterMatch && (
            <p className="review-sharing-status">Opponent code sharing was off for this round.</p>
          )}
          <div className="review-toolbar">
            <SelectField
              label="View code"
              value={compare ? "compare" : selected || "own"}
              options={[
                { value: "own", label: "Your code" },
                ...opponents.map((person) => ({ value: person.userId, label: person.displayName })),
                ...(opponents.length ? [{ value: "compare", label: "Compare" }] : []),
              ]}
              onChange={(value) => {
                setCompare(value === "compare");
                if (value !== "compare") setSelected(value === "own" ? "" : value);
              }}
            />
            {compare && other && (
              <SelectField
                label="Opponent"
                value={other.userId}
                options={opponents.map((person) => ({
                  value: person.userId,
                  label: person.displayName,
                }))}
                onChange={setSelected}
              />
            )}
            {own?.submission && local !== undefined && local !== own.submission.source && (
              <button className="quiet-button" onClick={() => setSubmitted(!submitted)}>
                {submitted ? "View saved draft" : "View last submission"}
              </button>
            )}
            {compare &&
              ownSource !== undefined &&
              other?.submission &&
              ownLanguage !== undefined &&
              ownLanguage === otherLanguage && (
                <button className="quiet-button" aria-pressed={diff} onClick={() => setDiff(!diff)}>
                  Diff
                </button>
              )}
          </div>
          {compare &&
          diff &&
          ownSource !== undefined &&
          other?.submission &&
          ownLanguage !== undefined &&
          ownLanguage === otherLanguage ? (
            <ReviewDiff
              original={ownSource}
              source={other.submission.source}
              language={ownLanguage}
              theme={theme}
              colorScheme={editorSchemes[theme]}
            />
          ) : (
            <div className="review-code-grid">
              {(compare || !selected) &&
                code(
                  submitted
                    ? `Your submission · ${own?.submission?.verdict ?? own?.submission?.state}`
                    : "Your code",
                  ownSource,
                  ownLanguage,
                  submitted || local === undefined ? "Your submitted code" : "Your saved code",
                )}
              {(compare || selected) &&
                other &&
                code(
                  other.displayName,
                  other.submission?.source,
                  otherLanguage,
                  `${other.displayName} submitted code`,
                )}
            </div>
          )}
        </>
      }
      results={<WorkspaceTests problem={data.problem} busy={false} />}
      actions={<span>Read-only review</span>}
    />
  );
}
