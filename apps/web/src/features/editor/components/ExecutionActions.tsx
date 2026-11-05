/** @file ExecutionActions.tsx @description One execution action row for every coding workspace. @module editor */
import { workspaceShortcuts } from "../workspaceShortcuts";
import { Icon } from "../../../ui/Icon";
import { ShortcutHint } from "../../../ui/ShortcutKeys";
import { Tooltip } from "../../../ui/Tooltip";

export function ExecutionActions({
  disabled,
  runDisabled = disabled,
  onRun,
  onSubmit,
  onCancel,
}: {
  disabled: boolean;
  runDisabled?: boolean;
  onRun: () => void;
  onSubmit: () => void;
  onCancel?: () => void;
}) {
  return (
    <div className="run-actions">
      {onCancel && (
        <button className="quiet-button" onClick={onCancel}>
          Cancel run
        </button>
      )}
      <Tooltip content={<ShortcutHint shortcut={workspaceShortcuts.run} />}>
        <button className="button button-secondary" disabled={runDisabled} onClick={onRun}>
          <Icon name="play" />
          Run
        </button>
      </Tooltip>
      <Tooltip content={<ShortcutHint shortcut={workspaceShortcuts.submit} />}>
        <button className="button button-primary" disabled={disabled} onClick={onSubmit}>
          <Icon name="submit" />
          Submit
        </button>
      </Tooltip>
    </div>
  );
}
