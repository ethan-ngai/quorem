/** @file TeamOrganizer.tsx @description Private lobby team selection and host balancing. @module factions */
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { PartySnapshot } from "@quorem/contracts";
import type { TeamLobby } from "@quorem/contracts/factions";
import { partyRequest } from "../matches/party";
import { SelectField } from "../../ui/SelectField";
import { NoticeRegion } from "../../ui/PersistentNotice";
import { PartyMemberReadiness } from "../matches/PartyReadyStatus";
import "./factions.css";
export function TeamOrganizer({ party, identity }: { party: PartySnapshot; identity: string }) {
  const client = useQueryClient();
  const query = useQuery({
    queryKey: ["party-teams", party.id],
    queryFn: () => partyRequest<TeamLobby>(`/v1/parties/${party.id}/teams`),
    refetchInterval: 2000,
  });
  const [busy, setBusy] = useState(false);
  const [organizing, setOrganizing] = useState(false);
  const [error, setError] = useState<string>();
  const host = party.hostUserId === identity;
  async function change(body: Record<string, unknown>) {
    if (busy) return;
    setBusy(true);
    setError(undefined);
    try {
      const next = await partyRequest<TeamLobby>(`/v1/parties/${party.id}/teams`, "POST", body);
      client.setQueryData(["party-teams", party.id], next);
      await client.invalidateQueries({ queryKey: ["current-party"] });
    } catch {
      setError("Could not organize teams. Refresh and try again.");
    } finally {
      setBusy(false);
    }
  }
  if (!query.data)
    return (
      <NoticeRegion
        message={query.isError ? "Teams unavailable" : undefined}
        actions={[{ label: "Retry", onClick: () => void query.refetch() }]}
      >
        <p role="status">Loading teams…</p>
      </NoticeRegion>
    );
  const { teamCount, assignments } = query.data;
  return (
    <section className="faction-organizer" aria-label="Teams">
      <NoticeRegion message={error}>
        <div className="faction-toolbar">
          <h2>Teams</h2>
          <button
            type="button"
            className="quiet-button"
            aria-expanded={organizing}
            onClick={() => setOrganizing((open) => !open)}
          >
            {organizing ? "Done" : host ? "Organize teams" : "Change team"}
          </button>
          {host && organizing && (
            <>
              <SelectField
                label="Team count"
                value={String(teamCount)}
                onChange={(value) => void change({ action: "count", count: Number(value) })}
                disabled={busy}
                options={[2, 3, 4].map((n) => ({ value: String(n), label: `${n} teams` }))}
              />
              <button
                type="button"
                className="button button-secondary"
                disabled={busy}
                onClick={() => void change({ action: "balance" })}
              >
                Auto-balance
              </button>
            </>
          )}
        </div>
      </NoticeRegion>
      <div className="faction-teams">
        {Array.from({ length: teamCount + 1 }, (_, index) => index)
          .filter((team) => team > 0 || assignments.some((member) => member.team === null))
          .map((team) => {
            const members = party.members.filter(
              (m) => assignments.find((a) => a.userId === m.userId)?.team === (team || null),
            );
            return (
              <section key={team} className="faction-team">
                <h3>
                  {team ? `Team ${team}` : "Unassigned"}
                  <span>{members.length}</span>
                </h3>
                {members.length === 0 ? (
                  <p className="faction-empty">{team ? "Join this team" : "Everyone assigned"}</p>
                ) : (
                  <PartyMemberReadiness
                    members={members}
                    hostUserId={party.hostUserId}
                    ownUserId={identity}
                    actions={
                      organizing
                        ? (member) =>
                            host || member.userId === identity ? (
                              <SelectField
                                label={`Team for ${member.displayName}`}
                                value={String(team)}
                                disabled={busy}
                                onChange={(value) =>
                                  void change({
                                    action: "assign",
                                    userId: member.userId,
                                    team: Number(value) || null,
                                  })
                                }
                                options={[
                                  { value: "0", label: "Unassigned" },
                                  ...Array.from({ length: teamCount }, (_, i) => ({
                                    value: String(i + 1),
                                    label: `Team ${i + 1}`,
                                  })),
                                ]}
                              />
                            ) : null
                        : undefined
                    }
                  />
                )}
                {team > 0 && assignments.find((a) => a.userId === identity)?.team !== team && (
                  <button
                    className="quiet-button"
                    disabled={busy}
                    onClick={() => void change({ action: "assign", userId: identity, team })}
                  >
                    Join team
                  </button>
                )}
              </section>
            );
          })}
      </div>
    </section>
  );
}
