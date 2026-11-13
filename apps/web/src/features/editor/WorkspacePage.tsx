import type { SharedWorkspaceDocument } from "../collaboration/sharedWorkspace";
import {
  MatchAssistance,
  ruleCostLabel,
  type MatchDisclosureControls,
} from "../matches/MatchAssistance";
import { matchRuleAction } from "../matches/api";
import { SelectField } from "../../ui/SelectField";
import type { AcceptancePolicy, RuleActionQuote } from "@quorem/contracts/match-rules";
import {
  matchCompletionOutcome,
  ownParticipant,
  submissionTimeEndedLabel,
} from "../matches/matchState";
import { personalSubmissionDeadline } from "../matches/matchTime";
import { useSubmissionTimeEnded } from "../matches/useSubmissionTimeEnded";
/** @file WorkspacePage.tsx @description Coordinates problem loading and editor workspace panes. @module editor */
import { useErrorNotification } from "../../ui/Notifications";
import { useLocalEditorPreferences } from "../settings/useLocalEditorPreferences";
import { WorkspaceCompletion } from "../completion/WorkspaceCompletion";
import { SessionDialog } from "../../ui/SessionDialog";
import { userFacingErrorMessage } from "../../ui/errors";
import { useHotkey } from "@tanstack/react-hotkeys";
import { workspaceShortcuts } from "./workspaceShortcuts";
import {
  type DevelopmentIdentity,
  type MatchSnapshot,
  type PublishedQuestion,
} from "@quorem/contracts";
import { RotateCcw } from "lucide-react";
import { Tooltip } from "../../ui/Tooltip";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo, useEffect, useRef, useState, type ReactNode } from "react";
import { GlobalNav } from "../navigation/GlobalNav";
import { useMatchRules } from "../matches/useMatchRules";
import { fetchWorkspace, createWorkspace, switchMatchLanguage } from "./api";
import { EditorialPanel, type EditorialComplexity } from "./components/EditorialPanel";
import { ProblemStatement } from "./components/ProblemStatement";
import { PersistentNotice } from "../../ui/PersistentNotice";
import { LoadingScreen } from "../../ui/LoadingScreen";
import { CreateMatchDialog } from "../matches/CreateMatchDialog";
import { SaveIndicator } from "./components/SaveIndicator";
import { readPreference, writePreference } from "./editorSettings";
import { readBrowserDraft } from "./recovery";
import { authenticatedFetch } from "../auth/session";
import { ReviewToolbar, ReviewPaneHeader } from "../matches/ReviewToolbar";
import { EditorialCode } from "./components/EditorialCode";
import {
  useMatchReview,
  createReviewWorkspace,
  saveMatchReviewCode,
  reviewCodeLanguage,
  initialReviewSource,
} from "../matches/useMatchReview";
import { ReviewComparison } from "../matches/ReviewComparison";
import "../matches/review.css";
import { useTheme } from "./useTheme";
import { canExecuteDocument } from "./executionGuard";
import { passedCaseLevels } from "../odyssey/caseFeedback";
import { OdysseyStepper } from "../odyssey/OdysseyStepper";
import { unlockedMethodEdit } from "../odyssey/methodStubs";
import { publicOdysseyPreview } from "../odyssey/publicPreview";
import { OdysseyPanel } from "../odyssey/OdysseyPanel";
import { interviewRequest } from "../interviews/api";
import type { OdysseyProgress } from "@quorem/contracts";
import { useSubmission } from "./useSubmission";
import { useWorkspaceDraft } from "./useWorkspaceDraft";
import { hostedIntelligenceEnabled } from "./intelligenceConfig";
import { pythonNeedsDatetime } from "./questionTypes";
import { useIntelligence } from "./useIntelligence";
import { PythonEditor, type PythonEditorHandle } from "./PythonEditor";
import { WorkspaceLayout } from "./components/WorkspaceLayout";
import { SolutionControls } from "./components/SolutionToolbar";
import { WorkspaceTests } from "./components/WorkspaceTests";
import { ExecutionActions } from "./components/ExecutionActions";
import "../../styles/workspace.css";

const practiceTiers = { small: 1, efficient: 2 };

type Panel = "problem" | "code" | "results";

/** Returns a safe short message for load and save failures. */
function errorMessage(error: unknown) {
  return userFacingErrorMessage(error, "Something went wrong. Your code is still here.");
}

/** Opens one public problem in the resizable practice workspace. */
import { guestWorkspace } from "./guestWorkspace";
import { useSession } from "../auth/session";
import { problemQueryOptions } from "../practice/problemQueries";
import { usePageTitle } from "../navigation/PageMetadata";
import { matchModeLabels } from "../matches/ModeIcon";
import { languageFileNames, type EditorLanguage } from "./editorLanguages";
import { LoadingIndicator } from "../../ui/Spinner";

export function WorkspacePage({
  slug = "",
  match,
  matchWorkspaceId: providedMatchWorkspaceId,
  identity: providedIdentity,
  matchHeader,
  review = false,
  reviewRequest,
  sharedDocument,
}: {
  slug?: string;
  match?: MatchSnapshot;
  matchWorkspaceId?: string;
  identity?: DevelopmentIdentity;
  matchHeader?:
    | ReactNode
    | ((problem: PublishedQuestion, saveDraft: () => Promise<void>) => ReactNode);
  review?: boolean;
  reviewRequest?: { participantId: string };
  sharedDocument?: SharedWorkspaceDocument;
}) {
  const originalSource = useRef<string | undefined>(undefined);
  const account = useSession();
  const identity = (account.data?.user.id ??
    providedIdentity ??
    "anonymous") as DevelopmentIdentity;
  const { preference: themePreference, setPreference: setThemePreference, theme } = useTheme();
  const [activePanel, setActivePanel] = useState<Panel>("code");
  const [createMatchOpen, setCreateMatchOpen] = useState(false);
  const [matchSelection, setMatchSelection] = useState<{ matchId: string; workspaceId: string }>();
  const matchWorkspaceId =
    matchSelection?.matchId === match?.id
      ? (matchSelection?.workspaceId ?? providedMatchWorkspaceId)
      : providedMatchWorkspaceId;
  const [languageSwitching, setLanguageSwitching] = useState(false);
  useEffect(() => {
    if (matchSelection && providedMatchWorkspaceId === matchSelection.workspaceId)
      setMatchSelection(undefined);
  }, [providedMatchWorkspaceId, matchSelection]);
  const [selectedLanguage, setSelectedLanguage] = useState<EditorLanguage>(() => {
    const saved = readPreference<string>(`quorem.language.v1.${slug}`, "python");
    return ["python", "java", "typescript", "ocaml", "postgresql"].includes(saved)
      ? (saved as EditorLanguage)
      : "python";
  });
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [signInPrompt, setSignInPrompt] = useState(false);
  const signInPromptOrigin = useRef<HTMLElement | null>(null);
  const [submissionConfirmation, setSubmissionConfirmation] = useState<{
    quote: RuleActionQuote;
    source: string;
  }>();
  const [quotingSubmission, setQuotingSubmission] = useState(false);
  const [actionError, setActionError] = useState<string>();
  useErrorNotification(actionError);
  const {
    editorSchemes,
    onEditorSchemeChange: setEditorScheme,
    fontSize,
    onFontSizeChange: setFontSize,
    tabSize,
    onTabSizeChange: setTabSize,
    wrap,
    onWrapChange: setWrap,
  } = useLocalEditorPreferences();
  const editorRef = useRef<PythonEditorHandle>(null);
  const queryClient = useQueryClient();
  const problemOptions = problemQueryOptions(
    queryClient,
    account.data === undefined ? undefined : identity,
    match?.problemVersionId ?? slug,
    !!match,
  );
  const problemQuery = useQuery({
    ...problemOptions,
    queryFn:
      match && matchWorkspaceId
        ? async () => {
            const response = await authenticatedFetch(
              new URL(
                `/v1/workspaces/${encodeURIComponent(matchWorkspaceId)}/problem`,
                import.meta.env.VITE_API_BASE_URL ?? window.location.origin,
              ),
            );
            if (!response.ok) throw new Error("Could not load the match problem.");
            return response.json() as Promise<PublishedQuestion>;
          }
        : problemOptions.queryFn,
    enabled: problemOptions.enabled && (!match || !!matchWorkspaceId),
  });
  const question = problemQuery.data;
  const currentQuestion = match
    ? account.data && match.startedAt && question?.id === match.problemVersionId
    : question?.slug === slug;
  const mode = match ? matchModeLabels[match.mode] : "Practice";
  usePageTitle(
    currentQuestion && question?.title
      ? `${question.title} - ${mode}${review ? " Review" : ""}`
      : undefined,
  );
  const activeLanguage = problemQuery.data?.languages?.some(
    (item) => item.language === selectedLanguage,
  )
    ? selectedLanguage
    : (problemQuery.data?.languages?.[0]?.language ?? selectedLanguage);
  const [appliedReviewRequest, setAppliedReviewRequest] = useState(reviewRequest);
  const [reviewParticipantId, setReviewParticipantId] = useState(reviewRequest?.participantId);
  const [compareReview, setCompareReview] = useState(false);
  const [diffReview, setDiffReview] = useState(false);
  const [showOriginal, setShowOriginal] = useState(false);
  const [comparisonSource, setComparisonSource] = useState<{
    participantId: string;
    language: EditorLanguage;
    source: string;
  }>();
  const reviewSettling = review && !!match?.reviewPending;
  const reviewQuery = useMatchReview(identity, match?.id, review && !reviewSettling);
  const own = match && ownParticipant(match, identity);
  const reviewToolbar = reviewQuery.data ?? {
    participants: own ? [{ ...own, own: true, workspace: null, submission: null }] : [],
  };
  const [reviewExpired, setReviewExpired] = useState(false);
  useEffect(() => {
    if (!reviewQuery.data) return;
    const delay = Date.parse(reviewQuery.data.completedAt) + 86_400_000 - Date.now();
    if (delay <= 0) {
      setReviewExpired(true);
      return;
    }
    setReviewExpired(false);
    const timer = window.setTimeout(() => setReviewExpired(true), delay);
    return () => window.clearTimeout(timer);
  }, [reviewQuery.data?.completedAt]);
  const reviewParticipant =
    reviewQuery.data?.participants.find((person) => person.userId === reviewParticipantId) ??
    reviewQuery.data?.participants.find((person) => person.own);
  const [reviewLanguageOverride, setReviewLanguageOverride] = useState<EditorLanguage>();
  if (appliedReviewRequest !== reviewRequest) {
    setAppliedReviewRequest(reviewRequest);
    setReviewParticipantId(reviewRequest?.participantId);
    setReviewLanguageOverride(undefined);
    setShowOriginal(false);
  }
  const reviewLanguage =
    reviewLanguageOverride ?? reviewCodeLanguage(reviewParticipant) ?? selectedLanguage;
  const reviewCode = reviewParticipant?.finalCode ?? reviewParticipant?.submission;
  const originalLabel = reviewParticipant?.finalCode
    ? "Final code"
    : reviewParticipant?.submission?.winning
      ? "Winning submission"
      : "Original submission";
  const reviewReference = reviewQuery.data?.participants.find(
    (person) => person.userId !== reviewParticipant?.userId && !!reviewCodeLanguage(person),
  );
  const loadReviewWorkspace = review && !reviewSettling;
  const workspaceQuery = useQuery({
    queryKey: [
      "workspace",
      identity,
      loadReviewWorkspace ? match?.id : (matchWorkspaceId ?? problemQuery.data?.id),
      loadReviewWorkspace ? reviewParticipant?.userId : null,
      loadReviewWorkspace ? reviewLanguage : activeLanguage,
    ],
    queryFn: () =>
      loadReviewWorkspace
        ? createReviewWorkspace(match!.id, reviewParticipant!.userId, reviewLanguage)
        : match
          ? fetchWorkspace(identity, matchWorkspaceId!)
          : createWorkspace(identity, problemQuery.data!.id, activeLanguage),
    enabled:
      !!account.data &&
      (account.data.kind !== "guest" || !!match) &&
      (loadReviewWorkspace
        ? !!reviewParticipant && !reviewExpired
        : match
          ? !!matchWorkspaceId
          : !!problemQuery.data),
    staleTime: 0,
    gcTime: 5 * 60_000,
  });

  const loadedWorkspace = useMemo(() => {
    if (account.data && (account.data.kind !== "guest" || match)) return workspaceQuery.data;
    if (!account.isPending && !match && problemQuery.data)
      return guestWorkspace(problemQuery.data, activeLanguage);
    return undefined;
  }, [
    account.data,
    account.isPending,
    match,
    problemQuery.data,
    activeLanguage,
    workspaceQuery.data,
  ]);

  const matchDeadline = match && !review ? (match.submissionDeadline ?? match.deadline) : undefined;
  const personalDeadline =
    match && !review
      ? personalSubmissionDeadline(match, ownParticipant(match, identity)?.penaltySeconds)
      : undefined;
  const matchTimeEnded = useSubmissionTimeEnded(match?.serverNow, matchDeadline);
  const personalTimeEnded = useSubmissionTimeEnded(
    match?.serverNow,
    personalDeadline === matchDeadline ? undefined : personalDeadline,
  );
  const submitClosed = matchTimeEnded || personalTimeEnded;
  const frozenMatch =
    !!match &&
    (review
      ? reviewSettling || !loadedWorkspace || reviewExpired
      : match.state !== "active" || !!own?.forfeited);
  const sharedDraft = loadedWorkspace?.kind === "match" ? sharedDocument : undefined;
  const frozenRef = useRef(frozenMatch);
  frozenRef.current = frozenMatch;
  const {
    problem,
    workspace,
    source,
    sourceRef,
    saveState,
    customMode,
    setCustomMode,
    customDrafts,
    changeCustomDrafts,
    contextKey,
    updateSource,
    saveCurrentDraft,
    saveBeforeSwitch,
  } = useWorkspaceDraft({
    identity,
    canEdit: !frozenMatch,
    accountPresent: !!account.data,
    queriedProblem: problemQuery.data,
    loadedWorkspace,
    editorRef,
    authoritative: !!sharedDraft,
    initialSource:
      sharedDraft?.source ??
      (review && reviewParticipant
        ? initialReviewSource(
            reviewParticipant,
            reviewLanguage,
            () =>
              originalSource.current ??
              readBrowserDraft(
                identity,
                reviewParticipant.workspace!.id,
                problemQuery.data?.id ?? "",
              ),
          )
        : undefined),
    saveMatchSource:
      match?.shareFinalCode && !sharedDocument && !review && !frozenMatch
        ? (workspaceId, source) => saveMatchReviewCode(match.id, workspaceId, source)
        : undefined,
    onError: (error) => setActionError(errorMessage(error)),
  });

  if (workspace?.kind === "match") originalSource.current = sourceRef.current;

  const dataMatchesRoute =
    (match ? problemQuery.data?.id === match.problemVersionId : problemQuery.data?.slug === slug) &&
    loadedWorkspace?.problemVersionId === problemQuery.data?.id;
  const dataMatchesState =
    problem?.id === problemQuery.data?.id && workspace?.id === loadedWorkspace?.id;
  const serverWorkspace = !!account.data && (account.data.kind !== "guest" || !!match);
  const loading =
    (review && (reviewSettling || reviewExpired || reviewQuery.isPending || !reviewParticipant)) ||
    problemQuery.isPending ||
    account.isPending ||
    (serverWorkspace && workspaceQuery.isPending) ||
    !dataMatchesRoute ||
    !dataMatchesState ||
    !problem ||
    !workspace;
  const [visibleAuthor, setVisibleAuthor] = useState<string>();
  if (review && !loading && visibleAuthor !== reviewParticipant?.userId)
    setVisibleAuthor(reviewParticipant?.userId);
  const matchRules = useMatchRules(identity, review ? undefined : match);
  const documentLanguage = (workspace?.language ?? activeLanguage) as EditorLanguage;
  const odyssey = useQuery({
    queryKey: ["odyssey", workspace?.id],
    queryFn: () => interviewRequest<OdysseyProgress>(`/v1/workspaces/${workspace!.id}/odyssey`),
    enabled: !!workspace && !!problem?.odyssey && serverWorkspace,
    refetchOnWindowFocus: "always",
    refetchOnReconnect: "always",
  });
  const previewOdyssey = useMemo(
    () => (!serverWorkspace ? publicOdysseyPreview(problem) : undefined),
    [serverWorkspace, problem],
  );
  const displayedOdyssey = odyssey.data ?? previewOdyssey;
  useEffect(() => {
    if (loading || !displayedOdyssey || frozenMatch) return;
    if (sharedDocument && !review) {
      sharedDocument.updateOdyssey(displayedOdyssey, documentLanguage);
      return;
    }
    let cancelled = false;
    async function append() {
      for (let attempt = 0; attempt < 3 && !cancelled; attempt++) {
        const editor = editorRef.current;
        if (!editor) return;
        const before = editor.getSource();
        const edit = await unlockedMethodEdit(before, documentLanguage, displayedOdyssey!.levels);
        if (cancelled || frozenRef.current) return;
        if (editor.getSource() !== before) continue;
        if (edit) editor.applyEdit(edit.from, edit.to, edit.insert);
        return;
      }
    }
    void append();
    return () => {
      cancelled = true;
    };
  }, [loading, displayedOdyssey, documentLanguage, workspace?.id, frozenMatch, review]);
  const [resettingOdyssey, setResettingOdyssey] = useState(false);
  const [selectedLevel, setSelectedLevel] = useState<number>();
  const runExamples = useMemo(
    () => odyssey.data?.levels.flatMap((level) => level.examples),
    [odyssey.data],
  );
  const [practiceSelection, setPracticeSelection] = useState<{
    workspaceId: string;
    target: AcceptancePolicy;
  }>();
  const practiceTargets = match ? undefined : problem?.practiceTargets;
  const practiceTarget =
    practiceSelection?.workspaceId === workspace?.id ? practiceSelection?.target : undefined;
  const [practicePass, setPracticePass] = useState<{ workspaceId: string; tier: number }>();
  const practiceTier = Math.max(
    workspace?.practiceTier ?? 0,
    practicePass?.workspaceId === workspace?.id ? (practicePass?.tier ?? 0) : 0,
  );
  const execution = useSubmission({
    practiceTarget,
    beforeExecution: review ? undefined : sharedDocument?.beforeExecution,
    sharedSubmissionId: review ? undefined : sharedDocument?.latestSubmissionId,
    runExamples,
    level: odyssey.data?.level,
    identity,
    workspace,
    sourceRef,
    editorRef,
    customMode,
    drafts: customDrafts,
    problem,
    enabled:
      serverWorkspace &&
      !resettingOdyssey &&
      (!problem?.odyssey || !!odyssey.data) &&
      !languageSwitching &&
      !matchRules.blocked &&
      canExecuteDocument({
        identity,
        contextKey: contextKey,
        problem,
        workspace,
        slug,
        match: review ? undefined : match,
        review: review ? { matchId: match!.id } : undefined,
        matchWorkspaceId,
        loaded: !loading,
      }),
  });
  const practiceSubmission = execution.submission;
  const practiceWorkspaceId = workspace?.kind === "solo" ? workspace.id : undefined;
  useEffect(() => {
    if (
      !practiceWorkspaceId ||
      practiceSubmission?.kind !== "submit" ||
      practiceSubmission.state !== "completed" ||
      practiceSubmission.verdict !== "accepted"
    )
      return;
    const tier = practiceTiers[practiceSubmission.practiceTarget ?? "efficient"];
    setPracticePass((previous) =>
      previous?.workspaceId === practiceWorkspaceId && previous.tier >= tier
        ? previous
        : { workspaceId: practiceWorkspaceId, tier },
    );
  }, [practiceSubmission, practiceWorkspaceId]);

  const [settledOdysseySubmission, setSettledOdysseySubmission] = useState<string>();
  const completedWorkspace = execution.submission?.workspaceId;
  const completedSubmission = execution.submission?.id;
  const submissionState = execution.submission?.state;
  useEffect(() => {
    if (
      !problem?.odyssey ||
      !workspace ||
      completedWorkspace !== workspace.id ||
      submissionState !== "completed"
    )
      return;
    let current = true;
    void queryClient.invalidateQueries({ queryKey: ["odyssey", workspace.id] }).then(() => {
      if (current) setSettledOdysseySubmission(completedSubmission);
    });
    return () => {
      current = false;
    };
  }, [
    completedSubmission,
    completedWorkspace,
    submissionState,
    problem?.odyssey,
    workspace,
    queryClient,
  ]);
  const submission = execution.submission;
  const submissionBusy = execution.busy;
  const admissionPending = execution.admissionPending;
  const changeLanguage = async (language: EditorLanguage) => {
    if (languageSwitching || submissionBusy || admissionPending) return;
    setLanguageSwitching(true);
    setActionError(undefined);
    try {
      await saveBeforeSwitch();
      if (sharedDocument && !review) {
        await sharedDocument.changeLanguage(language);
      } else if (review) {
        setReviewLanguageOverride(language);
      } else if (match) {
        const selected = await switchMatchLanguage(identity, match.id, language);
        setMatchSelection({ matchId: match.id, workspaceId: selected.id });
      } else {
        writePreference(`quorem.language.v1.${slug}`, language);
        setSelectedLanguage(language);
      }
    } catch (error) {
      setActionError(errorMessage(error));
    } finally {
      setLanguageSwitching(false);
    }
  };
  const selectReviewParticipant = (value: string) => {
    if (languageSwitching || submissionBusy || admissionPending) return;
    setLanguageSwitching(true);
    void saveBeforeSwitch()
      .then(() => {
        setReviewLanguageOverride(undefined);
        setReviewParticipantId(value);
        setShowOriginal(false);
      })
      .catch((error) => setActionError(errorMessage(error)))
      .finally(() => setLanguageSwitching(false));
  };
  const run = useCallback(async () => {
    if (matchTimeEnded) return;
    if (!account.data || (account.data.kind === "guest" && !match)) {
      signInPromptOrigin.current = document.activeElement as HTMLElement | null;
      setSignInPrompt(true);
      return;
    }
    setActivePanel("results");
    await execution.run();
  }, [execution.run, account.data, match, matchTimeEnded]);
  const submit = useCallback(async () => {
    if (!account.data || (account.data.kind === "guest" && !match)) {
      signInPromptOrigin.current = document.activeElement as HTMLElement | null;
      setSignInPrompt(true);
      return;
    }
    if (submitClosed || quotingSubmission || submissionConfirmation) return;
    setActivePanel("results");
    if (match && !review) {
      setQuotingSubmission(true);
      try {
        if (sharedDocument && !(await sharedDocument.beforeExecution("submit"))) return;
        const source = editorRef.current?.getSource() ?? sourceRef.current;
        const { quote } = await matchRuleAction(identity, match.id, { kind: "submission" });
        if (quote.cooldownSeconds) {
          setActionError(`Submit available in ${quote.cooldownSeconds}s.`);
          return;
        }
        if ((quote.seconds || quote.points) && sharedDocument)
          await sharedDocument.requestPaidAction({ kind: "submission" });
        else if (quote.seconds || quote.points) setSubmissionConfirmation({ quote, source });
        else if (await execution.submit(quote, source)) setCustomMode(false);
      } catch (error) {
        setActionError(errorMessage(error));
      } finally {
        setQuotingSubmission(false);
      }
    } else if (await execution.submit()) setCustomMode(false);
  }, [
    execution.submit,
    account.data,
    match,
    review,
    identity,
    submitClosed,
    quotingSubmission,
    submissionConfirmation,
    sharedDocument,
  ]);

  const hotkeyOptions = {
    enabled: !settingsOpen && !signInPrompt && !submissionConfirmation,
    ignoreInputs: false,
    requireReset: true,
  };
  useHotkey(workspaceShortcuts.run.binding, () => void run(), hotkeyOptions);
  useHotkey(workspaceShortcuts.submit.binding, () => void submit(), hotkeyOptions);
  useHotkey(workspaceShortcuts.save.binding, () => void saveCurrentDraft(), hotkeyOptions);

  const loadError =
    (reviewExpired ? new Error("This review has expired.") : undefined) ??
    reviewQuery.error ??
    problemQuery.error ??
    workspaceQuery.error ??
    account.error;
  const retryLoading = () => {
    if (account.data === undefined) {
      void account.refetch();
      return;
    }
    if (review) void reviewQuery.refetch();
    if (problemOptions.enabled && (!match || !!matchWorkspaceId)) void problemQuery.refetch();
    if (serverWorkspace && (match ? !!matchWorkspaceId : !!problemQuery.data))
      void workspaceQuery.refetch();
  };
  const virtualDocumentUri = `file:///workspace/${languageFileNames[documentLanguage]}`;
  const editorDocumentKey = workspace
    ? `${identity}:${workspace.id}:${workspace.problemVersionId}:${documentLanguage}`
    : "pending";
  const browserIntelligenceAvailable =
    documentLanguage === "python" || documentLanguage === "typescript";
  const intelligence = useIntelligence(
    identity,
    editorDocumentKey,
    !loading && browserIntelligenceAvailable,
    documentLanguage,
    account.data?.kind !== "guest" && account.data?.capabilities?.hostedIntelligence === true,
    match?.rules?.automaticImports
      ? "common"
      : documentLanguage === "python" &&
          pythonNeedsDatetime(problem?.signature, displayedOdyssey?.levels)
        ? "datetime"
        : "none",
  );
  const intelligenceStatus = browserIntelligenceAvailable ? intelligence.status : "unavailable";
  const intelligenceHint = !browserIntelligenceAvailable
    ? "IntelliSense unavailable for this language."
    : {
        ready: "IntelliSense active",
        connecting: "IntelliSense connecting",
        paused: "IntelliSense paused. Follows the focused window automatically.",
        unavailable: "IntelliSense unavailable",
      }[intelligenceStatus];

  const actionsEnabled =
    !!account.data &&
    (!problem?.odyssey || !!odyssey.data) &&
    !languageSwitching &&
    !matchRules.blocked &&
    canExecuteDocument({
      identity,
      contextKey: contextKey,
      problem,
      workspace,
      slug,
      match: review ? undefined : match,
      review: review ? { matchId: match!.id } : undefined,
      matchWorkspaceId,
      loaded: !loading,
    });
  if (!problem || !workspace) {
    if (!loadError) return <LoadingScreen />;
    return (
      <main className="workspace-loading" aria-live="polite">
        <h1>Workspace unavailable</h1>
        <p>{errorMessage(loadError)}</p>
        <button className="button button-secondary" onClick={retryLoading}>
          Retry
        </button>
      </main>
    );
  }

  const solutionControls = (
    <SolutionControls
      language={documentLanguage}
      iconOnly={review}
      languages={problem.languages ?? [{ language: "python" }]}
      disabled={
        loading ||
        languageSwitching ||
        submissionBusy ||
        admissionPending ||
        (!!match && !review && (match.state !== "active" || matchRules.blocked))
      }
      onChange={(value) => void changeLanguage(value)}
      intelligence={
        hostedIntelligenceEnabled || browserIntelligenceAvailable
          ? { status: intelligenceStatus, hint: intelligenceHint }
          : undefined
      }
    />
  );

  const assistance = review ? undefined : match?.rules.assistance;
  const renderProblem = (controls?: MatchDisclosureControls) => {
    const topicControls = {
      allowTopics: assistance?.topics.access !== "blocked",
      topicsDisabled: controls?.disabled,
      requestTopics:
        controls &&
        assistance &&
        assistance.topics.access !== "free" &&
        assistance.topics.access !== "blocked"
          ? (anchor: HTMLButtonElement, open: (tags: string[]) => void) =>
              controls.reveal("topics", anchor, ({ topics }) => {
                if (topics) open(topics);
              })
          : undefined,
    };
    const editorial = (
      <EditorialPanel
        key={`${identity}:${workspace.id}:${problem.id}`}
        theme={theme}
        colorScheme={editorSchemes[theme]}
        available={problem.hasComplexity ?? false}
        solutionAvailable={!problem.odyssey && (!match || review) && !!problem.hasSolutions}
        identity={identity}
        versionId={problem.id}
        contextId={match?.id}
        language={documentLanguage}
        inMatch={!!assistance && assistance.complexity.access !== "free"}
        complexityDisabled={controls?.disabled}
        requestComplexity={
          controls &&
          assistance &&
          assistance.complexity.access !== "free" &&
          assistance.complexity.access !== "blocked"
            ? (anchor, open) =>
                controls.reveal("complexity", anchor, ({ complexity }) => {
                  if (complexity) open(JSON.parse(complexity) as EditorialComplexity);
                })
            : undefined
        }
      />
    );
    if (!problem.odyssey) {
      return (
        <ProblemStatement problem={problem} {...topicControls}>
          {editorial}
        </ProblemStatement>
      );
    }
    if (displayedOdyssey) {
      return (
        <OdysseyPanel
          {...topicControls}
          progress={displayedOdyssey}
          problem={problem}
          selectedLevel={selectedLevel}
        >
          {editorial}
        </OdysseyPanel>
      );
    }
    if (account.data && !odyssey.isError) return <LoadingIndicator label="Loading levels…" />;
    return (
      <p className="result-message" role="status">
        {!account.data
          ? "Sign in to start Odyssey."
          : "Odyssey is unavailable for this account. Reload to retry."}
      </p>
    );
  };

  // A review draft can load independently while the previous editor stays visible.
  const blockWorkspace = loading && (!review || reviewExpired);
  const renderWorkspace = (controls?: MatchDisclosureControls) => (
    <>
      {blockWorkspace && (
        <div className="workspace-loading workspace-transition">
          {loadError ? (
            <p role="alert">{errorMessage(loadError)}</p>
          ) : (
            <LoadingScreen label="Opening workspace…" />
          )}
          {loadError && (
            <button className="button button-secondary" onClick={retryLoading}>
              Retry
            </button>
          )}
        </div>
      )}
      <WorkspaceLayout
        language={documentLanguage}
        pending={blockWorkspace}
        navigation={
          <GlobalNav
            identity={identity}
            slug={match ? undefined : slug}
            mode={match?.mode}
            theme={themePreference}
            onThemeChange={setThemePreference}
            workspaceSettings={{
              onOpenChange: setSettingsOpen,
              theme: themePreference,
              onThemeChange: setThemePreference,
              editorSchemes,
              onEditorSchemeChange: setEditorScheme,
              fontSize: fontSize,
              onFontSizeChange: setFontSize,
              tabSize: tabSize,
              onTabSizeChange: setTabSize,
              wrap: wrap,
              onWrapChange: setWrap,
            }}
            onCreateMatch={() => {
              void saveCurrentDraft().then(() => setCreateMatchOpen(true));
            }}
          >
            <SaveIndicator state={saveState} onRetry={() => void saveCurrentDraft()} />
          </GlobalNav>
        }
        header={
          matchHeader || odyssey.data || (practiceTargets?.length ?? 0) > 1 ? (
            <>
              {typeof matchHeader === "function"
                ? matchHeader(problem, saveCurrentDraft)
                : matchHeader}
              {workspace && practiceTargets && practiceTargets.length > 1 && (
                <SelectField
                  label="Practice target"
                  value={practiceTarget ?? "efficient"}
                  disabled={execution.busy || execution.admissionPending}
                  options={practiceTargets.map((value) => ({
                    value,
                    label:
                      {
                        small: "Small inputs",
                        efficient: "Full constraints",
                      }[value] + (practiceTier >= practiceTiers[value] ? " ✓" : ""),
                  }))}
                  onChange={(target) =>
                    setPracticeSelection({
                      workspaceId: workspace.id,
                      target: target as AcceptancePolicy,
                    })
                  }
                />
              )}
              {(!matchHeader || review) && odyssey.data && (
                <OdysseyStepper
                  progress={odyssey.data}
                  passedLevels={passedCaseLevels(odyssey.data, execution.submission)}
                  selectedLevel={selectedLevel}
                  onSelect={setSelectedLevel}
                  actions={
                    (workspace?.kind === "solo" || review) && (
                      <Tooltip
                        content={review ? "Reset review progress" : "Reset Odyssey progress"}
                      >
                        <button
                          type="button"
                          className="icon-button"
                          aria-label={review ? "Reset review progress" : "Reset Odyssey progress"}
                          disabled={
                            resettingOdyssey ||
                            execution.busy ||
                            execution.admissionPending ||
                            languageSwitching
                          }
                          onClick={async () => {
                            if (resettingOdyssey || execution.busy || execution.admissionPending)
                              return;
                            setResettingOdyssey(true);
                            try {
                              await queryClient.cancelQueries({
                                queryKey: ["odyssey", workspace.id],
                              });
                              const progress = await interviewRequest<OdysseyProgress>(
                                `/v1/workspaces/${workspace.id}/odyssey/reset`,
                                "POST",
                              );
                              execution.clearResult();
                              setSelectedLevel(undefined);
                              queryClient.setQueryData(["odyssey", workspace.id], progress);
                            } catch (cause) {
                              setActionError(errorMessage(cause));
                            } finally {
                              setResettingOdyssey(false);
                            }
                          }}
                        >
                          <RotateCcw size={16} aria-hidden="true" />
                        </button>
                      </Tooltip>
                    )
                  }
                />
              )}
            </>
          ) : undefined
        }
        panel={activePanel}
        onPanelChange={setActivePanel}
        problem={renderProblem(controls)}
        editor={
          <>
            {review && (
              <ReviewToolbar
                review={reviewToolbar}
                participantId={
                  (loading ? (visibleAuthor ?? own?.userId) : reviewParticipant?.userId) ?? ""
                }
                disabled={loading || languageSwitching || submissionBusy || admissionPending}
                compare={compareReview}
                diff={diffReview}
                original={showOriginal}
                canCompare={!loading && !!reviewReference}
                canDiff={reviewCodeLanguage(reviewReference) === documentLanguage}
                originalLabel={originalLabel}
                onSelect={selectReviewParticipant}
                onCompare={() => setCompareReview(!compareReview)}
                onDiff={() => setDiffReview(!diffReview)}
                onOriginal={() => setShowOriginal(!showOriginal)}
                originalContent={
                  !loading &&
                  reviewCode && (
                    <>
                      <ReviewPaneHeader
                        name={originalLabel}
                        language={reviewCode.language as EditorLanguage}
                        original
                      />
                      <EditorialCode
                        source={reviewCode.source}
                        language={reviewCode.language as EditorLanguage}
                        label={originalLabel}
                        theme={theme}
                        colorScheme={editorSchemes[theme]}
                      />
                    </>
                  )
                }
              >
                {solutionControls}
                <PersistentNotice
                  message={
                    loading && !blockWorkspace && loadError ? errorMessage(loadError) : undefined
                  }
                  label="Review unavailable"
                  actions={[{ label: "Retry", onClick: retryLoading }]}
                />
              </ReviewToolbar>
            )}
            {!review && <div className="code-toolbar">{solutionControls}</div>}
            <div className="review-editor-grid">
              <div className="editor-frame">
                {review && compareReview && !diffReview && (
                  <ReviewPaneHeader
                    name={reviewParticipant?.displayName ?? "Player"}
                    self={reviewParticipant?.own}
                    participant={reviewParticipant}
                    language={documentLanguage}
                    active
                  />
                )}
                <PythonEditor
                  language={documentLanguage}
                  key={editorDocumentKey}
                  ref={editorRef}
                  documentKey={editorDocumentKey}
                  documentUri={virtualDocumentUri}
                  initialSource={source}
                  theme={theme}
                  colorScheme={editorSchemes[theme]}
                  fontSize={fontSize}
                  tabSize={tabSize}
                  wrap={wrap}
                  readOnly={
                    languageSwitching ||
                    frozenMatch ||
                    (review ? loading : !!match && matchRules.blocked)
                  }
                  mergeOriginal={
                    review &&
                    compareReview &&
                    diffReview &&
                    comparisonSource?.participantId === reviewReference?.userId &&
                    comparisonSource?.language === documentLanguage
                      ? comparisonSource.source
                      : undefined
                  }
                  completionEnabled={true}
                  intelligenceExtensions={
                    browserIntelligenceAvailable ? intelligence.extensions : undefined
                  }
                  collaborationExtension={!review ? sharedDocument?.extension : undefined}
                  onSourceChange={updateSource}
                />
              </div>
              {review && compareReview && reviewReference && match && (
                <ReviewComparison
                  key={reviewReference.userId}
                  identity={identity}
                  matchId={match.id}
                  participant={reviewReference}
                  problem={problem}
                  theme={theme}
                  colorScheme={editorSchemes[theme]}
                  fontSize={fontSize}
                  tabSize={tabSize}
                  wrap={wrap}
                  hidden={
                    diffReview &&
                    comparisonSource?.participantId === reviewReference.userId &&
                    comparisonSource.language === documentLanguage
                  }
                  onSource={setComparisonSource}
                  onSelect={() => selectReviewParticipant(reviewReference.userId)}
                  disabled={languageSwitching || submissionBusy || admissionPending}
                />
              )}
            </div>
          </>
        }
        results={
          <WorkspaceTests
            problem={problem}
            progress={displayedOdyssey}
            submission={submission}
            busy={admissionPending || (execution.isPending && !!execution.submissionId)}
            pendingKind={execution.pendingKind}
            error={execution.error}
            customMode={execution.pendingKind === "submit" ? false : customMode}
            onCustomModeChange={setCustomMode}
            drafts={customDrafts}
            onDraftsChange={frozenMatch ? undefined : changeCustomDrafts}
            snapshot={execution.runSnapshot}
            hiddenCaseDetails={controls?.hiddenCaseDetails}
          />
        }
        actions={
          <>
            <ExecutionActions
              submitDisabledReason={submitClosed ? submissionTimeEndedLabel : undefined}
              disabled={
                submitClosed ||
                submissionBusy ||
                (serverWorkspace ? !actionsEnabled : loading || languageSwitching)
              }
              runDisabled={
                matchTimeEnded ||
                (submissionBusy && !execution.canReplaceRun) ||
                (serverWorkspace ? !actionsEnabled : loading || languageSwitching)
              }
              onRun={() => void run()}
              onSubmit={() => void submit()}
              onCancel={execution.canAbort ? () => void execution.cancel() : undefined}
              abortPending={execution.abortPending}
            />
          </>
        }
      >
        {!review && (
          <WorkspaceCompletion
            key={workspace.id}
            submission={submission}
            workspaceId={workspace.id}
            title={problem.title}
            difficulty={problem.difficulty}
            language={documentLanguage}
            odyssey={problem.odyssey ? displayedOdyssey : undefined}
            odysseyReady={
              !problem.odyssey ||
              (!!odyssey.data && !odyssey.isError && settledOdysseySubmission === submission?.id)
            }
            competitive={!!match && !review}
            outcome={match ? matchCompletionOutcome(match, identity) : "success"}
          />
        )}
        <SessionDialog
          open={!!submissionConfirmation}
          onOpenChange={(open) => {
            if (!open) setSubmissionConfirmation(undefined);
          }}
          pending={execution.admissionPending}
          title="Submit with penalty?"
          description={
            submitClosed
              ? "Your submission window has closed."
              : `Cost: ${submissionConfirmation ? ruleCostLabel(submissionConfirmation.quote) : ""}. Submit the code captured when you clicked Submit.`
          }
        >
          <div className="competitive-dialog-actions">
            <button
              className="button button-secondary"
              disabled={execution.admissionPending}
              onClick={() => setSubmissionConfirmation(undefined)}
            >
              Cancel
            </button>
            <button
              className="button button-primary"
              disabled={execution.admissionPending || submitClosed}
              onClick={async () => {
                if (!submissionConfirmation || submitClosed) return;
                if (
                  await execution.submit(
                    submissionConfirmation.quote,
                    submissionConfirmation.source,
                  )
                ) {
                  setCustomMode(false);
                  setSubmissionConfirmation(undefined);
                }
              }}
            >
              Submit
            </button>
          </div>
        </SessionDialog>
        <SessionDialog
          open={signInPrompt}
          onOpenChange={setSignInPrompt}
          title="Sign in to run tests"
          description="Sign in to run tests and submit solutions. You can keep editing without an account."
          returnFocus={() => signInPromptOrigin.current?.focus()}
        >
          <div className="competitive-dialog-actions">
            <button className="button button-secondary" onClick={() => setSignInPrompt(false)}>
              Keep editing
            </button>
            <a
              className="button button-primary"
              href={`/login?returnTo=${encodeURIComponent(window.location.pathname + window.location.search + window.location.hash)}`}
            >
              Sign in
            </a>
          </div>
        </SessionDialog>
        {createMatchOpen && (
          <CreateMatchDialog identity={identity} onClose={() => setCreateMatchOpen(false)} />
        )}
      </WorkspaceLayout>
    </>
  );

  return match ? (
    <MatchAssistance
      key={`${match.id}:${identity}:${matchWorkspaceId}`}
      match={match}
      identity={identity}
      submission={submission}
      onPaidAction={sharedDocument?.requestPaidAction}
    >
      {(controls) => renderWorkspace(review ? undefined : controls)}
    </MatchAssistance>
  ) : (
    renderWorkspace()
  );
}
