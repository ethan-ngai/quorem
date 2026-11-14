/** @file AdminDashboard.tsx @description Administrator account, content and retained-activity overview. @module admin */
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import type { AdminOverview } from "@quorem/contracts";
import { ArrowUpRight, RefreshCw } from "lucide-react";
import { GlobalNav } from "../navigation/GlobalNav";
import { canAccess } from "../auth/adminAccess";
import { useSession } from "../auth/session";
import { useTheme } from "../editor/useTheme";
import { LoadingScreen } from "../../ui/LoadingScreen";
import { DelayedSpinner } from "../../ui/Spinner";
import { PersistentNotice } from "../../ui/PersistentNotice";
import { Table, TableRow } from "../../ui/Table";
import { getAdminOverview } from "./api";
import "./admin-dashboard.css";

const numbers = new Intl.NumberFormat();

/** @returns Live aggregates scoped to the current administrator session. */
export function AdminDashboard() {
  const session = useSession();
  const theme = useTheme();
  const overview = useQuery({
    queryKey: ["admin-overview", session.data?.user.id],
    queryFn: ({ signal }) => getAdminOverview(signal),
    enabled: canAccess(session.data, "admin"),
    staleTime: 30_000,
    retry: false,
  });
  const error = overview.isError
    ? "Overview could not be refreshed. Retry to load current platform data."
    : undefined;
  return (
    <>
      <GlobalNav theme={theme.preference} onThemeChange={theme.setPreference} />
      <main className="admin-overview">
        <header className="admin-overview-header">
          <div>
            <span className="admin-overview-eyebrow">Administration</span>
            <h1>Overview</h1>
            <p>Accounts, shared questions and platform activity.</p>
          </div>
          <div className="admin-overview-actions">
            <PersistentNotice
              message={overview.data ? error : undefined}
              label="Overview unavailable"
              actions={[{ label: "Retry", onClick: () => void overview.refetch() }]}
            />
            <button
              className="button button-secondary"
              disabled={overview.isFetching}
              onClick={() => void overview.refetch()}
            >
              <DelayedSpinner
                active={overview.isFetching && !!overview.data}
                label="Refreshing overview"
                fallback={<RefreshCw size={14} aria-hidden="true" />}
              />
              Refresh
            </button>
            <Link
              className="button button-secondary"
              to="/questions"
              search={{ section: "publications" }}
            >
              Question Editor <ArrowUpRight size={14} aria-hidden="true" />
            </Link>
          </div>
        </header>
        {overview.data ? (
          <>
            <AdminOverviewContent data={overview.data} />
            <p className="admin-overview-updated" role="status">
              {overview.isError ? "Showing the last loaded overview." : "Updated"}{" "}
              <DateTime value={overview.data.generatedAt} />
            </p>
          </>
        ) : overview.isError ? (
          <div className="admin-overview-empty" role="alert">
            <h2>Overview unavailable</h2>
            <p>Platform data could not be loaded.</p>
            <button
              className="button button-secondary"
              disabled={overview.isFetching}
              onClick={() => void overview.refetch()}
            >
              Retry
            </button>
          </div>
        ) : (
          <LoadingScreen label="Loading overview…" inline />
        )}
      </main>
    </>
  );
}

/** @returns Shared overview composition for live data and local fixtures. */
export function AdminOverviewContent({ data }: { data: AdminOverview }) {
  const { users, content, submissions } = data;
  return (
    <div className="admin-overview-content">
      <dl className="admin-overview-metrics" aria-label="Platform totals">
        <div>
          <dt>Accounts</dt>
          <dd>{numbers.format(users.accounts)}</dd>
          <dd className="admin-overview-metric-description">
            {numbers.format(users.administrators)} admins · {numbers.format(users.disabled)}{" "}
            disabled
          </dd>
        </div>
        <div>
          <dt>Published questions</dt>
          <dd>{numbers.format(content.publications)}</dd>
          <dd className="admin-overview-metric-description">Shared catalog</dd>
        </div>
        <div>
          <dt>Question drafts</dt>
          <dd>{numbers.format(content.drafts)}</dd>
          <dd className="admin-overview-metric-description">Shared, unpublished changes</dd>
        </div>
        <div>
          <dt>Submissions · 7 days</dt>
          <dd>{numbers.format(submissions.retained7d)}</dd>
          <dd className="admin-overview-metric-description">
            {numbers.format(users.active7d)} active accounts
          </dd>
        </div>
      </dl>
      <div className="admin-overview-columns">
        <section className="admin-overview-section" aria-labelledby="admin-active-heading">
          <header>
            <div>
              <h2 id="admin-active-heading">Active accounts</h2>
              <p>Latest submissions in the last 7 days</p>
            </div>
            <span className="admin-overview-count">
              {data.activeUsers.length} of {numbers.format(users.active7d)}
            </span>
          </header>
          {data.activeUsers.length ? (
            <div className="admin-overview-table">
              <Table
                label="Recently active accounts"
                heading={
                  <tr>
                    <th scope="col">Account</th>
                    <th scope="col">Submissions</th>
                    <th scope="col">Last submitted</th>
                  </tr>
                }
              >
                {data.activeUsers.map((user) => (
                  <TableRow key={user.id}>
                    <td>
                      <span className="admin-overview-account">{user.displayName}</span>
                      <span className="admin-overview-meta">
                        {user.disabled
                          ? "Disabled"
                          : user.role === "admin"
                            ? "Administrator"
                            : "Member"}
                      </span>
                    </td>
                    <td className="admin-overview-number">{numbers.format(user.submissions)}</td>
                    <td>
                      <DateTime value={user.lastSubmittedAt} />
                    </td>
                  </TableRow>
                ))}
              </Table>
            </div>
          ) : (
            <p className="admin-overview-empty-row">No account submissions in this period.</p>
          )}
        </section>
        <section className="admin-overview-section" aria-labelledby="admin-drafts-heading">
          <header>
            <div>
              <h2 id="admin-drafts-heading">Draft updates</h2>
              <p>Latest shared question changes</p>
            </div>
            <Link className="admin-overview-link" to="/questions" search={{ section: "drafts" }}>
              View all <ArrowUpRight size={13} aria-hidden="true" />
            </Link>
          </header>
          {data.recentDrafts.length ? (
            <ul className="admin-overview-drafts">
              {data.recentDrafts.map((draft) => (
                <li key={draft.id}>
                  <Link to="/questions" search={{ section: "drafts", draft: draft.id }}>
                    <span>{draft.title}</span>
                    <ArrowUpRight size={14} aria-hidden="true" />
                  </Link>
                  <span className="admin-overview-meta">
                    {draft.editingPublication ? "Publication edit" : "New question"} ·{" "}
                    <DateTime value={draft.updatedAt} />
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="admin-overview-empty-row">
              No shared drafts. Create a question in the editor.
            </p>
          )}
        </section>
      </div>
      <footer className="admin-overview-footer">
        <div>
          <span className="admin-overview-signal" data-busy={submissions.pending > 0} />
          <strong>{numbers.format(submissions.pending)}</strong> queued or running{" "}
          <span className="admin-overview-divider">·</span>{" "}
          <strong>{numbers.format(content.workspaces)}</strong> workspaces
        </div>
        <p>
          Submission counts reflect retained history since{" "}
          <DateTime value={data.windowStart} dateOnly />. Older submissions may have expired.
        </p>
      </footer>
    </div>
  );
}

/** @returns A localized timestamp with a machine-readable value. */
function DateTime({ value, dateOnly = false }: { value: string; dateOnly?: boolean }) {
  const date = new Date(value);
  return (
    <time dateTime={value} title={date.toLocaleString()}>
      {dateOnly
        ? date.toLocaleDateString(undefined, { month: "short", day: "numeric" })
        : date.toLocaleString(undefined, {
            month: "short",
            day: "numeric",
            hour: "numeric",
            minute: "2-digit",
          })}
    </time>
  );
}
