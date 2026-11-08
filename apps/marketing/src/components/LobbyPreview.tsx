import { matchPreset } from "@quorem/contracts/match-rules";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MatchSettings } from "../../../web/src/features/matches/MatchControls";
import { ParticipantHost } from "../../../web/src/features/collaboration/ParticipantName";
import { ModeIcon } from "../../../web/src/features/matches/ModeIcon";
const catalog = [{ id: "two-sum-preview", title: "Two Sum", difficulty: "easy" }];
const settings = {
  mode: "free-for-all" as const,
  difficulties: ["easy" as const],
  selectedProblemVersionId: "two-sum-preview",
  durationMinutes: 30 as const,
  shareCodeAfterMatch: true,
  rules: matchPreset("balanced"),
};
/** Server-rendered shared controls: no session, hydration or catalog request. */
export default function LobbyPreview() {
  return (
    <div
      className="lobby-render"
      role="img"
      aria-label="Example Free-for-all lobby: Two Sum, 30 minutes, three ready players and host conduct rules."
    >
      <div inert aria-hidden="true">
        <div className="lobby-render-heading">
          <ModeIcon mode="free-for-all" />
          <strong>Free-for-all</strong>
          <span>Lobby</span>
        </div>
        <div className="competitive-seats ffa-seats">
          {["Alex", "Jamie", "Sam", "Open seat"].map((name, i) => (
            <div className="competitive-seat" key={name}>
              <span className="participant-avatar">{i === 3 ? "+" : name[0]}</span>
              <div>
                <strong className="participant-name">
                  {name}
                  {i === 0 && <ParticipantHost />}
                </strong>
                <span>{i === 0 ? "Host" : i === 3 ? "Invite a friend" : "Player"}</span>
              </div>
              {i < 3 && <span className="seat-readiness is-ready">✓</span>}
            </div>
          ))}
        </div>
        <QueryClientProvider client={new QueryClient()}>
          <MatchSettings
            value={settings}
            identity="alice"
            catalog={catalog}
            participantCount={3}
            disabled
            onChange={() => {}}
          />
        </QueryClientProvider>
        <div className="lobby-render-footer">
          <span>3 players ready</span>
          <span className="demo-primary-action">Starting match</span>
        </div>
      </div>
    </div>
  );
}
