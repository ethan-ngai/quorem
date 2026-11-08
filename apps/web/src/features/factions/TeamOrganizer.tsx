import { InlineNameEditor } from "../../ui/InlineNameEditor";
import { factionName, factionNameInputSchema, factionNameSchema } from "@quorem/contracts/factions";
import type { InputConstraint } from "../../ui/input-constraints";
import { useFactionLobby } from "./useFactionLobby";
import { AnimatedRows } from "../../ui/AnimatedRows";
import { StateIcon } from "../../ui/StateIcon";
import { DragDropProvider, useDraggable, useDroppable } from "@dnd-kit/react";
/** @file TeamOrganizer.tsx @description Private lobby team selection and host balancing. @module factions */
import { useQueryClient } from "@tanstack/react-query";
import {
  Shuffle,
  LockKeyhole,
  UnlockKeyhole,
  UserPlus,
  GripVertical,
  Plus,
  Trash2,
} from "lucide-react";
import { Tooltip } from "../../ui/Tooltip";
import { PersistentNotice } from "../../ui/PersistentNotice";
import { useState, type ReactNode } from "react";
import type { PartySnapshot } from "@quorem/contracts";
import { organizeFactions } from "./api";
import { NoticeRegion } from "../../ui/PersistentNotice";
import { PartyMemberReadiness } from "../matches/PartyReadyStatus";
import "./factions.css";
import { LoadingIndicator } from "../../ui/Spinner";

const factionNameConstraint: InputConstraint = {
  edit: (value) => factionNameInputSchema.safeParse(value).success,
  schema: factionNameSchema,
  trim: true,
};

export function TeamOrganizer({
  party,
  identity,
  memberActions,
}: {
  party: PartySnapshot;
  identity: string;
  memberActions?: (
    member: Pick<PartySnapshot["members"][number], "userId" | "displayName">,
  ) => ReactNode;
}) {
  const client = useQueryClient();
  const query = useFactionLobby(party.id);
  const [busy, setBusy] = useState(false);
  const [lockPending, setLockPending] = useState(false);
  const controlsBusy = busy && !lockPending;
  const [error, setError] = useState<string>();
  const host = party.hostUserId === identity;
  const changesLocked = !!party.settings.factionChangesLocked;
  async function change(body: Record<string, unknown>) {
    if (busy) return;
    setBusy(true);
    setLockPending(body.action === "lock");
    setError(undefined);
    try {
      const next = await organizeFactions(party.id, body);
      client.setQueryData(["party-teams", party.id], next);
      await client.invalidateQueries({ queryKey: ["current-party"] });
      return true;
    } catch {
      setError("Could not update factions. Try again.");
      return false;
    } finally {
      setBusy(false);
      setLockPending(false);
    }
  }
  if (!query.data)
    return (
      <NoticeRegion
        message={query.isError ? "Factions unavailable" : undefined}
        actions={[{ label: "Retry", onClick: () => void query.refetch() }]}
      >
        <LoadingIndicator label="Loading factions…" />
      </NoticeRegion>
    );
  const { teamCount, assignments, names } = query.data;
  return (
    <DragDropProvider
      onDragEnd={(event) => {
        if (event.canceled) return;
        const { source, target } = event.operation;
        if (source && target && typeof source.id === "string" && typeof target.id === "number")
          void change({ action: "assign", userId: source.id, team: target.id }).then(() => {
            requestAnimationFrame(() =>
              document.getElementById(`faction-grip-${source.id}`)?.focus(),
            );
          });
      }}
    >
      <section className="faction-organizer" aria-label="Factions">
        <div className="faction-toolbar">
          <h2>
            Factions{" "}
            <span className="faction-size-summary" aria-label="Faction sizes">
              {Array.from(
                { length: teamCount },
                (_, i) =>
                  assignments.filter(
                    (a) => a.team === i + 1 && party.members.some((m) => m.userId === a.userId),
                  ).length,
              ).join(" v ")}
            </span>
          </h2>
          <div className="faction-toolbar-actions">
            <PersistentNotice message={error} />
            {!host && changesLocked && (
              <Tooltip content="Faction changes are locked by the host">
                <span role="img" aria-label="Faction changes locked" tabIndex={0}>
                  <LockKeyhole size={16} aria-hidden="true" />
                </span>
              </Tooltip>
            )}
            {host && (
              <>
                <Tooltip content={teamCount >= 4 ? "Maximum four factions" : "Add faction"}>
                  <button
                    type="button"
                    className="button button-secondary"
                    disabled={controlsBusy || teamCount >= 4}
                    onClick={() => void change({ action: "create" })}
                  >
                    <Plus size={16} aria-hidden="true" />
                    Add faction
                  </button>
                </Tooltip>
                <Tooltip
                  content={changesLocked ? "Unlock faction changes" : "Lock faction changes"}
                >
                  <button
                    type="button"
                    className="icon-button"
                    aria-label={changesLocked ? "Unlock faction changes" : "Lock faction changes"}
                    aria-pressed={changesLocked}
                    aria-busy={lockPending}
                    disabled={busy}
                    onClick={() => void change({ action: "lock", locked: !changesLocked })}
                  >
                    <StateIcon
                      active={changesLocked}
                      on={<LockKeyhole size={16} />}
                      off={<UnlockKeyhole size={16} />}
                    />
                  </button>
                </Tooltip>
                <Tooltip content="Auto-balance factions">
                  <button
                    type="button"
                    className="icon-button"
                    aria-label="Auto-balance factions"
                    disabled={controlsBusy}
                    onClick={() => void change({ action: "balance" })}
                  >
                    <Shuffle size={16} aria-hidden="true" />
                  </button>
                </Tooltip>
              </>
            )}
          </div>
        </div>
        <AnimatedRows
          className="faction-teams"
          as="ul"
          items={Array.from({ length: teamCount }, (_, index) => index + 1)}
          renderRow={(team) => {
            const members = party.members.filter(
              (m) => assignments.find((a) => a.userId === m.userId)?.team === team,
            );
            return (
              <FactionDropZone
                key={team}
                faction={team}
                disabled={controlsBusy || (!host && changesLocked)}
                action={
                  host && teamCount > 2 ? (
                    <Tooltip content="Delete faction and reassign its players">
                      <button
                        type="button"
                        className="icon-button destructive-icon icon-button-danger faction-delete"
                        data-reveal
                        aria-label={`Delete ${factionName(team, names)}`}
                        disabled={controlsBusy}
                        onClick={() => void change({ action: "delete", team })}
                      >
                        <Trash2 size={16} aria-hidden="true" />
                      </button>
                    </Tooltip>
                  ) : undefined
                }
              >
                <InlineNameEditor
                  heading="h3"
                  label="Faction name"
                  constraint={factionNameConstraint}
                  value={factionName(team, names)}
                  disabled={controlsBusy}
                  editable={
                    host ||
                    (!changesLocked &&
                      assignments.some(
                        (member) => member.userId === identity && member.team === team,
                      ))
                  }
                  validate={(name) =>
                    names?.some(
                      (existing, i) =>
                        i + 1 !== team && existing.toLowerCase() === name.toLowerCase(),
                    )
                      ? "That faction name is already used."
                      : undefined
                  }
                  onSave={(name) => change({ action: "rename", team, name })}
                />
                <PartyMemberReadiness
                  members={members}
                  hostUserId={party.hostUserId}
                  ownUserId={identity}
                  actions={(member) => (
                    <>
                      {memberActions?.(member)}
                      {host || (!changesLocked && member.userId === identity) ? (
                        <FactionDragHandle
                          userId={member.userId}
                          name={member.displayName}
                          disabled={controlsBusy}
                        />
                      ) : null}
                    </>
                  )}
                />
                {team > 0 && assignments.find((a) => a.userId === identity)?.team !== team && (
                  <button
                    className="button button-secondary faction-join"
                    aria-label={`Join ${factionName(team, names)}`}
                    disabled={controlsBusy || (!host && changesLocked)}
                    onClick={() => void change({ action: "assign", userId: identity, team })}
                  >
                    <UserPlus size={16} aria-hidden="true" /> Join
                  </button>
                )}
              </FactionDropZone>
            );
          }}
        />
      </section>
    </DragDropProvider>
  );
}

function FactionDropZone({
  faction,
  disabled,
  children,
  action,
}: {
  action?: ReactNode;
  faction: number;
  disabled: boolean;
  children: ReactNode;
}) {
  const { ref, isDropTarget } = useDroppable({ id: faction, disabled });
  return (
    <section
      ref={ref}
      className="faction-team action-reveal-group"
      data-drop-target={isDropTarget || undefined}
    >
      {children}
      {action}
    </section>
  );
}
function FactionDragHandle({
  userId,
  name,
  disabled,
}: {
  userId: string;
  name: string;
  disabled: boolean;
}) {
  const { ref, handleRef } = useDraggable({ id: userId, disabled });
  return (
    <Tooltip content="Drag to move between factions">
      <button
        type="button"
        className="icon-button faction-drag-handle"
        data-reveal
        disabled={disabled}
        id={`faction-grip-${userId}`}
        aria-label={`Move ${name}`}
        ref={(element) => {
          handleRef(element);
          ref(element?.closest("li") ?? null);
        }}
      >
        <GripVertical size={16} aria-hidden="true" />
      </button>
    </Tooltip>
  );
}
