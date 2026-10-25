import * as Switch from "@radix-ui/react-switch";
import "./toggle-switch.css";

export function ToggleSwitch({
  label,
  checked,
  onChange,
  disabled = false,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <Switch.Root
      className="settings-switch"
      aria-label={label}
      checked={checked}
      disabled={disabled}
      onCheckedChange={onChange}
    >
      <Switch.Thumb className="settings-switch-thumb" />
    </Switch.Root>
  );
}
