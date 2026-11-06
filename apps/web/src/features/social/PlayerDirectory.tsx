/** @file PlayerDirectory.tsx @description Search and server-paginate eligible account profiles. @module social */
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { getCoreRowModel, useReactTable, type PaginationState } from "@tanstack/react-table";
import { useState } from "react";
import type { PlayerIdentity } from "@quorem/contracts";
import {
  socialPageSize,
  playerSearchMaxLength,
  playerSearchMaxOffset,
} from "@quorem/contracts/social-policy";
import { LoadingScreen } from "../../ui/LoadingScreen";
import { PersistentNotice } from "../../ui/PersistentNotice";
import { SearchField } from "../../ui/SearchField";
import { Table } from "../../ui/Table";
import { TablePagination } from "../../ui/TableControls";
import { PlayerLink, ReadFailure } from "./components";
import { canRetainSocialData, getPlayers } from "./api";
const emptyPlayers: PlayerIdentity[] = [];
const columns = [{ accessorKey: "displayName" }];
export function PlayerDirectory({ actor }: { actor: string }) {
  const [draft, setDraft] = useState(""),
    [search, setSearch] = useState("");
  const [pagination, setPagination] = useState<PaginationState>({
    pageIndex: 0,
    pageSize: socialPageSize,
  });
  const players = useQuery({
    queryKey: ["players", actor, search, pagination.pageIndex],
    queryFn: ({ signal }) => getPlayers(search, pagination.pageIndex * socialPageSize, signal),
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  });
  const data = canRetainSocialData(players.error) ? players.data : undefined;
  const table = useReactTable({
    data: data?.items ?? emptyPlayers,
    columns,
    getCoreRowModel: getCoreRowModel(),
    manualPagination: true,
    rowCount: Math.min(data?.total ?? 0, playerSearchMaxOffset + socialPageSize),
    state: { pagination },
    onPaginationChange: setPagination,
  });
  return (
    <section aria-labelledby="players-title">
      <div className="social-section-heading">
        <h2 id="players-title">Players</h2>
        <PersistentNotice
          message={data && players.isError ? "Player search could not be refreshed." : undefined}
          label="Players unavailable"
          actions={[{ label: "Retry", onClick: () => void players.refetch() }]}
        />
      </div>
      <form
        className="social-search"
        onSubmit={(event) => {
          event.preventDefault();
          setSearch(draft.trim());
          setPagination({ pageIndex: 0, pageSize: socialPageSize });
        }}
      >
        <SearchField
          aria-label="Search players"
          placeholder="Search name or @username"
          maxLength={playerSearchMaxLength}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
        />
        <button className="button button-secondary" type="submit">
          Search
        </button>
      </form>
      {data ? (
        data.items.length ? (
          <div className="social-directory" tabIndex={0} aria-label="Players">
            <Table
              label="Players"
              density="compact"
              heading={
                <tr>
                  <th scope="col">Player</th>
                </tr>
              }
            >
              {data.items.map((player) => (
                <tr key={player.id}>
                  <td>
                    <PlayerLink player={player} />
                  </td>
                </tr>
              ))}
            </Table>
          </div>
        ) : (
          <p className="social-empty">No players found. Try another name.</p>
        )
      ) : players.isError ? (
        <ReadFailure retry={() => void players.refetch()} />
      ) : (
        <LoadingScreen label="Loading players…" inline />
      )}
      <span className="sr-only" role="status">
        {players.isFetching ? "Updating players…" : ""}
      </span>
      <TablePagination table={table} disabled={players.isFetching} showPageSize={false} />
      {(data?.total ?? 0) > playerSearchMaxOffset + socialPageSize && (
        <p className="social-muted">Narrow your search to see more players.</p>
      )}
    </section>
  );
}
