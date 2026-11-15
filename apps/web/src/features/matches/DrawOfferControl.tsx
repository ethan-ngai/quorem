/** @file DrawOfferControl.tsx @description Shared Showdown draw confirmation and offer actions. @module matches */
import { LoadingButton } from "../../ui/LoadingButton";
import { useState } from "react";
import { Check, Undo2, X } from "lucide-react";
import { Icon } from "../../ui/Icon";
import * as Popover from "../../ui/Popover";
import { PersistentActionToast } from "../../ui/PersistentActionToast";
import { Tooltip } from "../../ui/Tooltip";
import "./draw-offer.css";

export function DrawOfferControl({
  matchId,
  offer,
  accepted,
  pending,
  onOffer,
  onRespond,
}: {
  matchId: string;
  offer?: { id: string; name: string; own: boolean };
  accepted: boolean;
  pending: boolean;
  onOffer: () => void | Promise<void>;
  onRespond: (action: "accept" | "decline" | "revoke", offerId: string) => void | Promise<void>;
}) {
  const [operation, setOperation] = useState<"offer" | "accept" | "decline" | "revoke">();
  const busy = pending || operation !== undefined;
  async function perform(action: NonNullable<typeof operation>, fn: () => void | Promise<void>) {
    if (busy) return;
    setOperation(action);
    try {
      await fn();
    } finally {
      setOperation(undefined);
    }
  }
  const [open, setOpen] = useState(false);
  const [mutedOfferId, setMutedOfferId] = useState<string>();
  const noticeId = accepted ? `${matchId}:accepted` : offer?.id;
  const icon = <Icon name="draw" />;
  const title = accepted
    ? "Draw accepted"
    : offer
      ? offer.own
        ? "You offered a draw"
        : `${offer.name} offered a draw`
      : "Offer a draw?";
  const actions = !accepted && (
    <>
      {!offer ? (
        <LoadingButton
          type="button"
          className="button button-primary"
          disabled={busy}
          onClick={() => void perform("offer", onOffer)}
          icon={icon}
          pending={operation === "offer"}
        >
          Offer draw
        </LoadingButton>
      ) : offer.own ? (
        <LoadingButton
          type="button"
          className="button button-secondary"
          disabled={busy}
          onClick={() => void perform("revoke", () => onRespond("revoke", offer.id))}
          icon={<Undo2 size={14} aria-hidden="true" />}
          iconSize={14}
          pending={operation === "revoke"}
        >
          Revoke offer
        </LoadingButton>
      ) : (
        <>
          <LoadingButton
            type="button"
            className="button button-primary"
            disabled={busy}
            onClick={() => void perform("accept", () => onRespond("accept", offer.id))}
            icon={<Check size={14} aria-hidden="true" />}
            iconSize={14}
            pending={operation === "accept"}
          >
            Accept draw
          </LoadingButton>
          <LoadingButton
            type="button"
            className="button button-secondary"
            disabled={busy}
            onClick={() => void perform("decline", () => onRespond("decline", offer.id))}
            icon={<X size={14} aria-hidden="true" />}
            iconSize={14}
            pending={operation === "decline"}
          >
            Decline
          </LoadingButton>
        </>
      )}
    </>
  );
  return (
    <Popover.Root
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (noticeId) setMutedOfferId(noticeId);
      }}
    >
      <Tooltip content="Draw" disabled={open}>
        <Popover.Trigger asChild>
          <button type="button" className="icon-button" aria-label="Draw">
            {icon}
          </button>
        </Popover.Trigger>
      </Tooltip>
      <Popover.Portal>
        <Popover.Content className="draw-offer-popover" align="end" aria-label={title}>
          <h2 className="draw-offer-title" title={title}>
            {title}
          </h2>
          {actions && <div className="draw-offer-actions">{actions}</div>}
        </Popover.Content>
      </Popover.Portal>
      {noticeId && (
        <PersistentActionToast
          id={`draw:${noticeId}`}
          title={title}
          noun="draw offer"
          icon={icon}
          hidden={open || mutedOfferId === noticeId}
          trigger={false}
          onMinimize={() => setMutedOfferId(noticeId)}
        >
          {actions && <div className="persistent-action-toast-actions">{actions}</div>}
        </PersistentActionToast>
      )}
    </Popover.Root>
  );
}
