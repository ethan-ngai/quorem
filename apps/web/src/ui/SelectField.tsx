import * as Select from "@radix-ui/react-select";
import { Check, ChevronDown, ChevronUp } from "lucide-react";
import type { ReactNode } from "react";
import "./select-field.css";

export type SelectOption = { value: string; label: string; leading?: ReactNode };

type SelectFieldProps = {
  label: string;
  value: string;
  options: readonly SelectOption[];
  onChange: (value: string) => void;
  disabled?: boolean;
  className?: string;
};

export function SelectField({
  label,
  value,
  options,
  onChange,
  disabled,
  className = "",
}: SelectFieldProps) {
  const selected = options.find((option) => option.value === value);
  return (
    <Select.Root value={value} onValueChange={onChange} disabled={disabled}>
      <Select.Trigger className={`select-field ${className}`} aria-label={label}>
        {selected?.leading}
        <Select.Value>{selected?.label}</Select.Value>
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
