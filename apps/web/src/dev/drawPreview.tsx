/** @file drawPreview.tsx @description Interactive fixture for both sides of a Showdown draw. @module dev */
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { DrawOfferControl } from "../features/matches/DrawOfferControl";
import { Notifications } from "../ui/Notifications";
import { randomUUID } from "../randomUUID";
import "@fontsource-variable/geist";
import "@quorem/ui/theme.css";
import "../styles/global.css";
import "./draw-preview.css";

type Player = "Ethan" | "Alex";

function DrawPreview() {
  const [viewer, setViewer] = useState<Player>("Ethan");
  const [offer, setOffer] = useState<{ id: string; name: Player }>();
  const [accepted, setAccepted] = useState(false);
  const [session, setSession] = useState(0);

  return (
    <main className="draw-preview">
      <Notifications />
      <h1>Showdown draw</h1>
      <div className="draw-preview-controls">
        <div className="draw-preview-controls" role="group" aria-label="Player perspective">
          {(["Ethan", "Alex"] as const).map((player) => (
            <button
              key={player}
              type="button"
              className={`button ${viewer === player ? "button-primary" : "button-secondary"}`}
              aria-pressed={viewer === player}
              onClick={() => setViewer(player)}
            >
              {player}
            </button>
          ))}
        </div>
        <button
          type="button"
          className="quiet-button"
          onClick={() => {
            setOffer(undefined);
            setAccepted(false);
            setSession((value) => value + 1);
          }}
        >
          Reset
        </button>
      </div>
      <section className="draw-preview-session" aria-label="Showdown toolbar">
        <span>
          {viewer} vs. {viewer === "Ethan" ? "Alex" : "Ethan"}
        </span>
        <DrawOfferControl
          key={`${session}:${viewer}`}
          matchId={`preview:${session}:${viewer}`}
          offer={offer && { ...offer, own: offer.name === viewer }}
          accepted={accepted}
          pending={false}
          onOffer={() => setOffer({ id: randomUUID(), name: viewer })}
          onRespond={(action) => {
            setOffer(undefined);
            setAccepted(action === "accept");
          }}
        />
      </section>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<DrawPreview />);
