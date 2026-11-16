/** @file CreateLobbyPage.tsx @description Full-page lobby setup. @module matches */
import { useTheme } from "../editor/useTheme";
import { GlobalNav } from "../navigation/GlobalNav";
import { usePageTitle } from "../navigation/PageMetadata";
import { CreateLobbySetup } from "./CreateMatchDialog";
import { useAccountIdentity } from "./MatchControls";

export function CreateLobbyPage() {
  const { identity } = useAccountIdentity();
  const { preference, setPreference } = useTheme();
  usePageTitle("Create Lobby - Quorem");
  return (
    <main className="match-page">
      <GlobalNav identity={identity} theme={preference} onThemeChange={setPreference} />
      <section className="match-page-content party-lobby">
        <CreateLobbySetup identity={identity} />
      </section>
    </main>
  );
}
