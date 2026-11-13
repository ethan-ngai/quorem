/** @file ExecutionActions.tsx @description One execution action row for every coding workspace. @module editor */
import { workspaceShortcuts } from "../workspaceShortcuts";
import { Icon } from "../../../ui/Icon";
import { ShortcutHint } from "../../../ui/ShortcutKeys";
import { Tooltip } from "../../../ui/Tooltip";

export function ExecutionActions({
  disabled,
  runDisabled = disabled,
  submitDisabledReason,
  onRun,
  onSubmit,
  onCancel,
  abortPending,
}: {
  disabled: boolean;
  runDisabled?: boolean;
  submitDisabledReason?: string;
  onRun: () => void;
  onSubmit: () => void;
  onCancel?: () => void;
  abortPending?: boolean;
}) {
  const submit = (
    <button className="button button-primary" disabled={disabled} onClick={onSubmit}>
      <Icon name="submit" />
      Submit
    </button>
  );
  return (
    <div className="run-actions">
      {onCancel && (
        <button className="button button-danger" disabled={abortPending} onClick={onCancel}>
          <Icon name="stop" />
          {abortPending ? "Aborting…" : "Abort"}
        </button>
      )}
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
        <Tooltip content={<ShortcutHint shortcut={workspaceShortcuts.submit} />}>{submit}</Tooltip>
      )}
    </div>
  );
}
