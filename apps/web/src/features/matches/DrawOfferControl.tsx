/** @file DrawOfferControl.tsx @description Shared Showdown draw confirmation and offer actions. @module matches */
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
  onOffer: () => void;
  onRespond: (action: "accept" | "decline" | "revoke", offerId: string) => void;
}) {
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
        <button
          type="button"
          className="button button-primary"
          disabled={pending}
          onClick={onOffer}
        >
          {icon} Offer draw
        </button>
      ) : offer.own ? (
        <button
          type="button"
          className="button button-secondary"
          disabled={pending}
          onClick={() => onRespond("revoke", offer.id)}
        >
          <Undo2 size={14} aria-hidden="true" /> Revoke offer
        </button>
      ) : (
        <>
          <button
            type="button"
            className="button button-primary"
            disabled={pending}
            onClick={() => onRespond("accept", offer.id)}
          >
            <Check size={14} aria-hidden="true" /> Accept draw
          </button>
          <button
            type="button"
            className="button button-secondary"
            disabled={pending}
            onClick={() => onRespond("decline", offer.id)}
          >
            <X size={14} aria-hidden="true" /> Decline
          </button>
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
