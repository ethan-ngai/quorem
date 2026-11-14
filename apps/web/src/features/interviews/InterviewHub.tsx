/** @file InterviewHub.tsx @description Gated interview hosting and resumable session discovery. @module interviews */
import { LoadingButton } from "../../ui/LoadingButton";
import type { paths } from "@quorem/contracts";
import { useServerTable, type ListState } from "../../ui/useServerTable";
import { TablePagination, TableSortHeader } from "../../ui/TableControls";
import { userFacingErrorMessage } from "../../ui/errors";
import { randomUUID } from "../../randomUUID";
import { LoadingScreen } from "../../ui/LoadingScreen";
import { DelayedSpinner } from "../../ui/Spinner";
import { scopedPlaceholder } from "../../ui/scopedPlaceholder";
import { Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type {
  InterviewSnapshot,
  InterviewSummary,
  InterviewCommandAck,
  InterviewQuestionInput,
  InterviewMonitoring,
} from "@quorem/contracts";
import { GlobalNav } from "../navigation/GlobalNav";
import { useSession } from "../auth/session";
import { useTheme } from "../editor/useTheme";
import { InterviewError, interviewRequest } from "./api";
import { SignInRedirect } from "../auth/RouteAccess";
import { isRouteDenied } from "../auth/protectedRoute";
import { NotFoundPage } from "../public/NotFoundPage";
import { InterviewInvitationLinks } from "./InterviewInvitations";
import { QuestionSetup } from "./QuestionSetup";
import { useErrorNotification } from "../../ui/Notifications";
import "../../styles/workspace.css";
import { CatalogLayout } from "../practice/CatalogLayout";
import { Table, TableRow } from "../../ui/Table";
import { Trash2, Power, Users, CircleDot, Archive } from "lucide-react";
import { Tooltip } from "../../ui/Tooltip";
import { InterviewLifecycleDialog } from "./InterviewLifecycleDialog";
import { SessionDialog } from "../../ui/SessionDialog";
/** Presents existing memberships even when host rollout access has been revoked. */
type InterviewPage =
  paths["/v1/interviews"]["get"]["responses"][200]["content"]["application/json"];
const interviewColumns = [
  { accessorKey: "title" },
  { accessorKey: "role" },
  { accessorKey: "updatedAt", sortDescFirst: true },
];
export function InterviewHub() {
  const account = useSession();
  const theme = useTheme();
  const navigate = useNavigate();
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState<InterviewSnapshot>();
  const [busy, setBusy] = useState(false);
  const [lifecycle, setLifecycle] = useState<{
    session: InterviewSummary;
    action: "end" | "delete";
  }>();
  const [error, setError] = useState<string>();
  useErrorNotification(error);
  const [list, setList] = useState<ListState<"title" | "role" | "updatedAt">>({
    page: 1,
    limit: 50,
    sort: "updatedAt",
    order: "desc",
  });
  const scope = ["interviews", account.data?.user.id] as const;
  const sessions = useQuery({
    queryKey: [...scope, list],
    placeholderData: scopedPlaceholder(scope),
    queryFn: ({ signal }) =>
      interviewRequest<InterviewPage>(
        `/v1/interviews?${new URLSearchParams({ ...list, page: String(list.page), limit: String(list.limit) })}`,
        "GET",
        undefined,
        undefined,
        signal,
      ),
    enabled: !!account.data,
    refetchOnWindowFocus: true,
  });
  async function create(
    question: InterviewQuestionInput,
    title: string,
    monitoring?: InterviewMonitoring,
  ) {
    setBusy(true);
    setError(undefined);
    try {
      const created = await interviewRequest<InterviewCommandAck>(
        "/v1/interviews",
        "POST",
        { title, question, monitoring },
        randomUUID(),
      );
      const session = await interviewRequest<InterviewSnapshot>(`/v1/interviews/${created.id}`);
      setCreated(session);
      await sessions.refetch();
    } catch (cause) {
      setError(userFacingErrorMessage(cause, "Could not create the interview. Try again."));
    } finally {
      setBusy(false);
    }
  }
  const table = useServerTable({
    data: sessions.data?.items ?? [],
    columns: interviewColumns,
    total: sessions.data?.total,
    loading: sessions.isFetching || sessions.isPlaceholderData,
    state: list,
    onChange: setList,
  });
  const hosting = sessions.data?.hosting ?? 0;
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
        randomUUID(),
      );
      await sessions.refetch();
      setLifecycle(action === "end" ? { session, action: "delete" } : undefined);
    } catch (cause) {
      setError(userFacingErrorMessage(cause, "Could not update the interview. Try again."));
    } finally {
      setBusy(false);
    }
  }
  const status = sessions.error instanceof InterviewError ? sessions.error.status : undefined;
  if (status === 401) return <SignInRedirect />;
  if (isRouteDenied(status)) return <NotFoundPage />;
  return (
    <div className="practice-page">
      <GlobalNav theme={theme.preference} onThemeChange={theme.setPreference} />
      <CatalogLayout
        title="Interviews"
        description="Collaborate in a shared coding workspace."
        actions={
          <div className="practice-heading-actions">
            <DelayedSpinner
              active={sessions.isFetching && !!sessions.data}
              label="Updating interviews"
            />
            {account.data?.capabilities?.interviews && (
              <button
                className="button button-primary"
                disabled={sessions.isPending || sessions.isError || atLimit}
                title={atLimit ? "End your active interview before hosting another" : undefined}
                onClick={() => {
                  setCreated(undefined);
                  setCreating(true);
                }}
              >
                New interview
              </button>
            )}
          </div>
        }
      >
        <section
          className="practice-catalog interview-catalog"
          aria-label="Interviews"
          aria-busy={sessions.isFetching}
        >
          {sessions.isPending ? (
            <LoadingScreen inline label="Loading interviews…" />
          ) : sessions.isError ? (
            <div className="practice-state" role="alert">
              <p>Could not load interviews.</p>
              <LoadingButton
                className="button button-secondary practice-retry"
                onClick={() => void sessions.refetch()}
                pending={sessions.isFetching}
              >
                Retry
              </LoadingButton>
            </div>
          ) : (
            <>
              <Table
                label="Interviews"
                heading={
                  <tr>
                    <TableSortHeader column={table.getColumn("title")!}>Interview</TableSortHeader>
                    <TableSortHeader
                      column={table.getColumn("role")!}
                      className="interview-role-column"
                    >
                      Your role
                    </TableSortHeader>
                    <th scope="col">
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                }
              >
                {sessions.data?.items.map((session) => (
                  <TableRow
                    key={session.id}
                    onOpen={() =>
                      void navigate({ to: "/interview/$id", params: { id: session.id } })
                    }
                  >
                    <td>
                      <div className="interview-title-line">
                        <Tooltip
                          content={
                            session.state === "closed"
                              ? "Closed: read-only interview"
                              : "Active: editing available"
                          }
                        >
                          <span
                            className="interview-row-status"
                            data-state={session.state}
                            tabIndex={0}
                            role="img"
                            aria-label={
                              session.state === "closed" ? "Closed interview" : "Active interview"
                            }
                          >
                            {session.state === "closed" ? (
                              <Archive size={15} aria-hidden="true" />
                            ) : (
                              <CircleDot size={15} aria-hidden="true" />
                            )}
                          </span>
                        </Tooltip>
                        <Link to="/interview/$id" params={{ id: session.id }}>
                          {session.title}
                        </Link>
                      </div>
                      <span className="interview-row-detail">{session.problemTitle}</span>
                      <span className="interview-mobile-meta">
                        {session.role === "interviewer" ? "Interviewer" : "Interviewee"} ·{" "}
                        {session.memberCount} {session.memberCount === 1 ? "member" : "members"}
                      </span>
                    </td>
                    <td className="interview-role-column">
                      {session.role === "interviewer" ? "Interviewer" : "Interviewee"}
                      <span className="interview-row-detail interview-member-count">
                        <Users size={13} aria-hidden="true" />
                        {session.memberCount} {session.memberCount === 1 ? "member" : "members"}
                      </span>
                    </td>
                    <td className="table-actions">
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
                              <Power size={16} />
                            )}
                          </button>
                        </Tooltip>
                      )}
                    </td>
                  </TableRow>
                ))}
              </Table>
              <TablePagination
                table={table}
                disabled={busy}
                snapshot={sessions.isPlaceholderData ? sessions.data : undefined}
              />
              {!sessions.data?.items.length && (
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
          <QuestionSetup
            onSubmit={(question, title, monitoring) => void create(question, title, monitoring)}
            busy={busy}
          />
        )}
      </SessionDialog>
    </div>
  );
}
