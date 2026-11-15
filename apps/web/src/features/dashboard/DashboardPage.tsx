/** @file DashboardPage.tsx @description Live signed-in player home. */
import { useQuery } from "@tanstack/react-query";
import { LoadingButton } from "../../ui/LoadingButton";
import { LoadingScreen } from "../../ui/LoadingScreen";
import { playerDashboardQuery } from "../activity/playerDashboardQuery";
import { useTheme } from "../editor/useTheme";
import { useAccountIdentity } from "../matches/MatchControls";
import { GlobalNav } from "../navigation/GlobalNav";
import { DashboardView } from "./DashboardView";

export function DashboardPage() {
  const { identity, account } = useAccountIdentity();
  const { preference, setPreference } = useTheme();
  const user = account.data?.kind === "guest" ? undefined : account.data?.user;
  const dashboard = useQuery(playerDashboardQuery(identity, !!user));

  return (
    <>
      <GlobalNav identity={identity} theme={preference} onThemeChange={setPreference} />
      {dashboard.isError || (!user && !account.isPending) ? (
        <main className="dashboard-demo">
          <section className="dashboard-panel" role="alert">
            <h1>Home</h1>
            <p>{user ? "Your activity couldn’t load." : "Sign in to view your activity."}</p>
            {user ? (
              <LoadingButton
                className="button button-secondary"
                pending={dashboard.isFetching}
                onClick={() => void dashboard.refetch()}
              >
                Retry
              </LoadingButton>
            ) : (
              <a className="button button-primary" href="/login?returnTo=%2Fhome">
                Sign in
              </a>
            )}
          </section>
        </main>
      ) : user && dashboard.data ? (
        <DashboardView data={dashboard.data} name={user.displayName} actor={identity} />
      ) : (
        <LoadingScreen label="Loading your activity…" />
      )}
    </>
  );
}
