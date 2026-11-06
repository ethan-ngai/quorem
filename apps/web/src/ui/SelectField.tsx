import * as Select from "@radix-ui/react-select";
import { Check, ChevronDown, ChevronUp } from "lucide-react";
import { useRef, useState, type ReactNode, type ComponentProps } from "react";
import "./select-field.css";
import { Tooltip } from "./Tooltip";

export type SelectOption = {
  value: string;
  label: string;
  leading?: ReactNode;
  trailing?: ReactNode;
  display?: ReactNode;
};

function optionContent(option: SelectOption | undefined) {
  if (!option) return undefined;
  return option.display === undefined ? (
    option.label
  ) : (
    <>
      {option.display}
      <span className="sr-only">{option.label}</span>
    </>
  );
}

type SelectFieldProps = {
  label: string;
  value: string;
  options: readonly SelectOption[];
  onChange: (value: string) => void;
  disabled?: boolean;
  iconOnly?: boolean;
  mono?: boolean;
  className?: string;
  triggerProps?: Pick<
    ComponentProps<"button">,
    "id" | "aria-describedby" | "aria-invalid" | "onBlur"
  >;
};

export function SelectField({
  label,
  value,
  options,
  onChange,
  disabled,
  iconOnly = false,
  mono = false,
  className = "",
  triggerProps,
}: SelectFieldProps) {
  const [open, setOpen] = useState(false);
  const closingPointer = useRef(false);
  const selected = options.find((option) => option.value === value);
  const trigger = (
    <Select.Trigger
      {...triggerProps}
      data-mono={mono || undefined}
      className={`${iconOnly ? "icon-button" : "select-field"} ${className}`}
      aria-label={iconOnly && selected ? `${label}: ${selected.label}` : label}
      // Radix blocks lower-layer pointer events while open; keep the trigger from clicking through its parent popover.
      style={open ? { pointerEvents: "auto" } : undefined}
      onPointerDown={(event) => {
        closingPointer.current = false;
        if (open && event.button === 0 && !event.ctrlKey) {
          event.preventDefault();
          closingPointer.current = true;
          setOpen(false);
        }
      }}
      onClick={(event) => {
        // Touch may dispatch a click after pointer dismissal; it must not reopen the menu.
        if (closingPointer.current) {
          event.preventDefault();
          closingPointer.current = false;
        }
      }}
      onKeyDown={() => {
        closingPointer.current = false;
      }}
    >
      {selected?.leading}
      {!iconOnly && (
        <>
          <span className="select-field-label">
            <Select.Value placeholder={selected?.label}>{optionContent(selected)}</Select.Value>
            {selected?.trailing}
          </span>
          <Select.Icon className="select-field-chevron">
            <ChevronDown size={14} aria-hidden="true" />
          </Select.Icon>
        </>
      )}
    </Select.Trigger>
  );
  return (
    <Select.Root
      value={value}
      onValueChange={onChange}
      disabled={disabled}
      open={open}
      onOpenChange={setOpen}
    >
      {iconOnly ? <Tooltip content={label}>{trigger}</Tooltip> : trigger}
      <Select.Portal>
        <Select.Content
          className="select-field-menu"
          data-mono={mono || undefined}
          position="popper"
          sideOffset={5}
          collisionPadding={12}
        >
          <Select.ScrollUpButton className="select-field-scroll">
            <ChevronUp size={14} aria-hidden="true" />
          </Select.ScrollUpButton>
          <Select.Viewport>
            {options.map((option) => (
              <Select.Item
                className="select-field-item"
                key={option.value}
                value={option.value}
                textValue={option.label}
              >
                {option.leading}
                <span className="select-field-label">
                  <Select.ItemText>{optionContent(option)}</Select.ItemText>
                  {option.trailing}
                </span>
                <span className="select-field-check">
                  <Select.ItemIndicator>
                    <Check size={14} aria-hidden="true" />
                  </Select.ItemIndicator>
                </span>
              </Select.Item>
            ))}
          </Select.Viewport>
          <Select.ScrollDownButton className="select-field-scroll">
            <ChevronDown size={14} aria-hidden="true" />
          </Select.ScrollDownButton>
        </Select.Content>
      </Select.Portal>
    </Select.Root>
  );
}
