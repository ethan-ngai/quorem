import * as Select from "@radix-ui/react-select";
import { Check, ChevronDown, ChevronUp } from "lucide-react";
import { useRef, useState, type ReactNode, type ComponentProps } from "react";
import "./select-field.css";

export type SelectOption = { value: string; label: string; leading?: ReactNode };

type SelectFieldProps = {
  label: string;
  value: string;
  options: readonly SelectOption[];
  onChange: (value: string) => void;
  disabled?: boolean;
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
  className = "",
  triggerProps,
}: SelectFieldProps) {
  const [open, setOpen] = useState(false);
  const closingPointer = useRef(false);
  const selected = options.find((option) => option.value === value);
  return (
    <Select.Root
      value={value}
      onValueChange={onChange}
      disabled={disabled}
      open={open}
      onOpenChange={setOpen}
    >
      <Select.Trigger
        {...triggerProps}
        className={`select-field ${className}`}
        aria-label={label}
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
        <Select.Value placeholder={selected?.label}>{selected?.label}</Select.Value>
        <Select.Icon className="select-field-chevron">
          <ChevronDown size={14} aria-hidden="true" />
        </Select.Icon>
      </Select.Trigger>
      <Select.Portal>
        <Select.Content
          className="select-field-menu"
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
                <Select.ItemText>{option.label}</Select.ItemText>
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
