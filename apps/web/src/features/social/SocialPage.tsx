import { PlayerDirectory } from "./PlayerDirectory";
import { PlayerLink, ReadFailure, Record } from "./components";
import { rivalryMinimumMatches, rivalryWindowDays } from "@quorem/contracts/social-policy";
/** @file SocialPage.tsx @description Automatic rivalries and searchable player profiles. @module social */
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useSession } from "../auth/session";
import { GlobalNav } from "../navigation/GlobalNav";
import { ParticipantName } from "../collaboration/ParticipantName";
import { useTheme } from "../editor/useTheme";
import { LoadingScreen } from "../../ui/LoadingScreen";
import { PersistentNotice } from "../../ui/PersistentNotice";
import { Table } from "../../ui/Table";
import { canRetainSocialData, getPlayer, getSocial } from "./api";
import "./social.css";

/** Shared frame prevents stale account data from rendering after sign-out. */
export function SocialPage({ playerId }: { playerId?: string }) {
  const session = useSession(),
    theme = useTheme();
  return (
    <>
      <GlobalNav theme={theme.preference} onThemeChange={theme.setPreference} />
      <main className="social-page">
        {session.isPending ? (
          <LoadingScreen label="Checking account…" inline />
        ) : session.isError ? (
          <ReadFailure retry={() => void session.refetch()} />
        ) : !session.data || session.data.kind === "guest" ? (
          <section className="social-empty">
            <h1>Meet your competition</h1>
            <p>Sign in to discover your rivals and explore player profiles.</p>
            <Link
              className="button"
              to="/login"
              search={{ returnTo: playerId ? `/players/${playerId}` : "/social" }}
            >
              Sign in
            </Link>
          </section>
        ) : playerId ? (
          <PlayerProfile
            key={`${session.data.user.id}:${playerId}`}
            actor={session.data.user.id}
            id={playerId}
          />
        ) : (
          <SocialHome key={session.data.user.id} actor={session.data.user.id} />
        )}
      </main>
    </>
  );
}
function SocialHome({ actor }: { actor: string }) {
  const overview = useQuery({
    queryKey: ["social", actor],
    queryFn: ({ signal }) => getSocial(signal),
    staleTime: 30_000,
  });
  const data = canRetainSocialData(overview.error) ? overview.data : undefined;
  return (
    <>
      <header className="social-heading">
        <div>
          <h1>Social</h1>
          <p>Track your rivals and find players.</p>
        </div>
        {data && (
          <Link
            className="button button-secondary"
            to="/players/$id"
            params={{ id: data.viewer.id }}
          >
            Your profile
          </Link>
        )}
      </header>
      <section aria-labelledby="rivals-title">
        <div className="social-section-heading">
          <h2 id="rivals-title">Your nemesis</h2>
          <PersistentNotice
            message={overview.isError ? "Rivalries could not be refreshed." : undefined}
            label="Rivalries unavailable"
            actions={[{ label: "Retry", onClick: () => void overview.refetch() }]}
          />
        </div>
        <p className="social-muted">
          At least {data?.minimumMatches ?? rivalryMinimumMatches} Showdowns together in{" "}
          {data?.windowDays ?? rivalryWindowDays} days. Ranked by losses, then matches played.
        </p>
        {data ? (
          data.rivals.length ? (
            <>
              <div className="social-nemesis">
                <PlayerLink player={data.rivals[0].player} />
                <Record value={data.rivals[0].record} />
              </div>
              {data.rivals.length > 1 && (
                <div className="social-table" tabIndex={0} aria-label="Other rivalries">
                  <Table
                    label="Other rivalries"
                    density="compact"
                    heading={
                      <tr>
                        <th scope="col">Opponent</th>
                        <th scope="col">Wins</th>
                        <th scope="col">Draws</th>
                        <th scope="col">Losses</th>
                        <th className="social-last-played" scope="col">
                          Last played
                        </th>
                      </tr>
                    }
                  >
                    {data.rivals.slice(1).map((rival) => (
                      <tr key={rival.player.id}>
                        <td>
                          <PlayerLink player={rival.player} />
                        </td>
                        <td>{rival.record.wins}</td>
                        <td>{rival.record.draws}</td>
                        <td>{rival.record.losses}</td>
                        <td className="social-last-played">
                          <time dateTime={rival.lastPlayedAt}>
                            {new Date(rival.lastPlayedAt).toLocaleDateString()}
                          </time>
                        </td>
                      </tr>
                    ))}
                  </Table>
                </div>
              )}
              <p className="social-muted">Your wins, draws and losses against each opponent.</p>
            </>
          ) : (
            <div className="social-empty">
              <h3>A rivalry starts with a rematch.</h3>
              <p>Complete three Showdowns against the same player to see them here.</p>
              <Link className="button button-secondary" to="/party">
                Open lobby
              </Link>
            </div>
          )
        ) : overview.isError ? (
          <ReadFailure retry={() => void overview.refetch()} />
        ) : (
          <LoadingScreen label="Finding rivalries…" inline />
        )}
      </section>
      <PlayerDirectory actor={actor} />
    </>
  );
}
function PlayerProfile({ actor, id }: { actor: string; id: string }) {
  const profile = useQuery({
    queryKey: ["player", actor, id],
    queryFn: ({ signal }) => getPlayer(id, signal),
    staleTime: 30_000,
    retry: false,
  });
  const data = canRetainSocialData(profile.error) ? profile.data : undefined;
  return (
    <>
      <Link className="text-link" to="/social">
        ← Social
      </Link>
      {data ? (
        <>
          <header className="social-heading">
            <div>
              <h1>
                <ParticipantName
                  participant={{ ...data.player, userId: data.player.id }}
                  self={data.isSelf}
                />
              </h1>
            </div>
            <PersistentNotice
              message={profile.isError ? "Profile could not be refreshed." : undefined}
              label="Profile unavailable"
              actions={[{ label: "Retry", onClick: () => void profile.refetch() }]}
            />
          </header>
          <section>
            <h2>Showdown record</h2>
            <p className="social-muted">
              Last {data.windowDays} days · Completed matches against active accounts
            </p>
            <Record value={data.record} />
            {!data.record.played && <p className="social-muted">No qualifying Showdowns yet.</p>}
          </section>
          {!data.isSelf && (
            <section>
              <h2>You vs. {data.player.displayName}</h2>
              <p className="social-muted">
                Your results against this player in the last {data.windowDays} days.
              </p>
              <Record value={data.headToHead} />
              {!data.headToHead.played && (
                <p className="social-muted">
                  You haven’t completed a qualifying Showdown together yet.
                </p>
              )}
            </section>
          )}
        </>
      ) : profile.isError ? (
        <ReadFailure retry={() => void profile.refetch()}>
          This player is unavailable, or the profile could not be loaded.
        </ReadFailure>
      ) : (
        <LoadingScreen label="Loading profile…" inline />
      )}
    </>
  );
}
