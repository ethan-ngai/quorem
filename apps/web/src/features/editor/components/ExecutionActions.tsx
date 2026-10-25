/** @file ExecutionActions.tsx @description One execution action row for every coding workspace. @module editor */
import { workspaceShortcuts } from "../workspaceShortcuts";
import { Icon } from "../../../ui/Icon";
import { ShortcutHint } from "./ShortcutKeys";
import { Tooltip } from "../../../ui/Tooltip";

export function ExecutionActions({
  disabled,
  onRun,
  onSubmit,
  onCancel,
}: {
  disabled: boolean;
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
        <button className="button button-secondary" disabled={disabled} onClick={onRun}>
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
