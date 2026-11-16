/** @file focusPreview.tsx @description Local fixture for match focus alerts and toast updates. @module dev */
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { participantUserId, type MatchSnapshot } from "@quorem/contracts";
import { matchPreset } from "@quorem/contracts/match-rules";
import { focusReturnDescription } from "../features/matches/matchTime";
import { useMatchRules } from "../features/matches/useMatchRules";
import { RoomAlerts, type RoomAlert } from "../features/rooms/RoomAlerts";
import { Notifications } from "../ui/Notifications";
import "@fontsource-variable/geist";
import "@quorem/ui/theme.css";
import "../styles/global.css";
import "../styles/workspace.css";

if (!import.meta.env.DEV) throw new Error("Development fixture only");

const now = new Date().toISOString();
const identity = "alice";
const ownId = participantUserId(identity);
const alexId = participantUserId("bob");
const snapshot: MatchSnapshot = {
  id: "local-focus-preview",
  version: "1",
  state: "active",
  mode: "showdown",
  difficulty: "easy",
  difficulties: ["easy"],
  durationMinutes: 30,
  serverNow: now,
  expiresAt: new Date(Date.now() + 30 * 60_000).toISOString(),
  hostUserId: ownId,
  rules: { ...matchPreset("casual"), focus: "warning" },
  participants: [{ userId: ownId, displayName: "You", ready: true, presence: "online" }],
  ruleEvents: [],
};
const client = new QueryClient();

function FocusPreview() {
  useMatchRules(identity, snapshot);
  const [alex, setAlex] = useState<{ events: RoomAlert[]; version: bigint }>({
    events: [],
    version: 0n,
  });
  const away = alex.events.at(-1)?.awaySeconds === undefined && alex.events.length > 0;
  const simulate = () =>
    setAlex(({ events, version }) => {
      const last = events.at(-1);
      if (last && last.awaySeconds === undefined) {
        const awaySeconds = (Date.now() - Date.parse(last.occurredAt)) / 1000;
        return {
          events: [
            ...events.slice(0, -1),
            { ...last, awaySeconds, description: focusReturnDescription(awaySeconds) },
          ],
          version: version + 1n,
        };
      }
      return {
        events: [
          ...events,
          {
            id: String(version),
            userId: alexId,
            name: "Alex",
            kind: "focus",
            occurredAt: new Date().toISOString(),
            description: "left the match window",
          },
        ],
        version: version + 1n,
      };
    });
  return (
    <main style={{ maxWidth: "36rem", padding: "var(--space-lg, 24px)", margin: "12vh auto" }}>
      <Notifications />
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <h1>Match focus alerts</h1>
        <RoomAlerts scope="local-focus-preview" label="Match alerts" {...alex} />
      </div>
      <p>Switch tabs or windows, then return to see your time away.</p>
      <p>
        Simulate Alex to see both toasts. Close the departure toast or wait seven seconds to see it
        reappear.
      </p>
      <button type="button" className="button button-secondary" onClick={simulate}>
        {away ? "Simulate Alex returning" : "Simulate Alex leaving"}
      </button>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(
  <QueryClientProvider client={client}>
    <FocusPreview />
  </QueryClientProvider>,
);
