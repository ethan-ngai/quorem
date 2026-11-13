/** @file ExecutionActions.tsx @description One execution action row for every coding workspace. @module editor */
import { workspaceShortcuts } from "../workspaceShortcuts";
import { Icon } from "../../../ui/Icon";
import { ShortcutHint } from "../../../ui/ShortcutKeys";
import { Spinner } from "../../../ui/Spinner";
import { Tooltip } from "../../../ui/Tooltip";

export function ExecutionActions({
  disabled,
  runDisabled = disabled,
  submitDisabledReason,
  onRun,
  onSubmit,
  onCancel,
  abortPending,
  busyLabel,
}: {
  disabled: boolean;
  runDisabled?: boolean;
  submitDisabledReason?: string;
  onRun: () => void;
  onSubmit: () => void;
  onCancel?: () => void;
  abortPending?: boolean;
  busyLabel?: string;
}) {
  const submit = (
    <button className="button button-primary" disabled={disabled} onClick={onSubmit}>
      <Icon name="submit" />
      Submit
    </button>
  );
  const busy = !!busyLabel;
  return (
    <div className="run-actions">
      <div className="run-action-group" data-active={!busy} inert={busy} aria-hidden={busy}>
        <Tooltip content={<ShortcutHint shortcut={workspaceShortcuts.run} />}>
          <button className="button button-secondary" disabled={runDisabled} onClick={onRun}>
            <Icon name="play" />
            Run
          </button>
        </Tooltip>
        {disabled && submitDisabledReason ? (
          <Tooltip content={submitDisabledReason}>
            <span className="disabled-action-hint" role="group" aria-label="Submit" tabIndex={0}>
              {submit}
            </span>
          </Tooltip>
        ) : (
          <Tooltip content={<ShortcutHint shortcut={workspaceShortcuts.submit} />}>
            {submit}
          </Tooltip>
        )}
      </div>
      <div className="run-action-group" data-active={busy} inert={!busy} aria-hidden={!busy}>
        <div
          className="run-action-state"
          data-active={!!onCancel}
          inert={!onCancel}
          aria-hidden={!onCancel}
        >
          <button
            className="button button-danger run-abort-button"
            aria-label={abortPending ? "Aborting…" : "Abort"}
            disabled={abortPending}
            onClick={onCancel}
          >
            <span className="run-action-state" data-active={!abortPending} aria-hidden="true">
              <Icon name="stop" />
              Abort
            </span>
            <span className="run-action-state" data-active={!!abortPending} aria-hidden="true">
              <Spinner active={!!abortPending} />
              Aborting…
            </span>
          </button>
        </div>
        <div className="run-action-state" data-active={!onCancel} aria-hidden={!!onCancel}>
          <span className="button run-action-status" role="status">
            <Spinner active={busy && !onCancel} />
            {busyLabel}
          </span>
        </div>
      </div>
    </div>
  );
}
