import {
  useRef,
  type ComponentProps,
  type ChangeEventHandler,
  type CompositionEventHandler,
  type FocusEventHandler,
} from "react";
import { isAllowedInput, type InputConstraint } from "./input-constraints";
import "./text-control.css";

type ControlStyle = { mono?: boolean; unstyled?: boolean; constraint?: InputConstraint };
type Element = HTMLInputElement | HTMLTextAreaElement;

type GuardProps<T extends Element> = {
  value?: string | number | readonly string[];
  defaultValue?: string | number | readonly string[];
  constraint?: InputConstraint;
  onChange?: ChangeEventHandler<T>;
  onBlur?: FocusEventHandler<T>;
  onCompositionStart?: CompositionEventHandler<T>;
  onCompositionEnd?: CompositionEventHandler<T>;
};

function useGuardedInput<T extends Element>({
  value,
  defaultValue,
  constraint,
  onChange,
  onBlur,
  onCompositionStart,
  onCompositionEnd,
}: GuardProps<T>) {
  const composing = useRef(false);
  const previous = useRef(String(value ?? defaultValue ?? ""));
  if (!composing.current && value !== undefined) previous.current = String(value);
  return {
    onChange: ((event) => {
      if (
        !constraint ||
        composing.current ||
        isAllowedInput(event.currentTarget.value, constraint)
      ) {
        if (!composing.current) previous.current = event.currentTarget.value;
        onChange?.(event);
      } else event.currentTarget.value = previous.current;
    }) satisfies ChangeEventHandler<T>,
    onCompositionStart: ((event) => {
      composing.current = true;
      onCompositionStart?.(event);
    }) satisfies CompositionEventHandler<T>,
    onCompositionEnd: ((event) => {
      composing.current = false;
      if (constraint && !isAllowedInput(event.currentTarget.value, constraint)) {
        event.currentTarget.value = previous.current;
        onChange?.(event as unknown as React.ChangeEvent<T>);
      } else previous.current = event.currentTarget.value;
      onCompositionEnd?.(event);
    }) satisfies CompositionEventHandler<T>,
    onBlur: ((event) => {
      if (constraint?.trim) {
        const trimmed = event.currentTarget.value.trimEnd();
        if (trimmed !== event.currentTarget.value) {
          event.currentTarget.value = trimmed;
          previous.current = trimmed;
          onChange?.(event as unknown as React.ChangeEvent<T>);
        }
      }
      onBlur?.(event);
    }) satisfies FocusEventHandler<T>,
  };
}

export function TextInput({
  mono,
  className = "",
  constraint,
  unstyled,
  ...props
}: ComponentProps<"input"> & ControlStyle) {
  const guarded = useGuardedInput<HTMLInputElement>({ ...props, constraint });
  return (
    <input
      {...props}
      {...guarded}
      className={unstyled ? className : `text-control ${className}`}
      data-mono={mono || undefined}
    />
  );
}

export function TextArea({
  mono,
  className = "",
  constraint,
  unstyled,
  ...props
}: ComponentProps<"textarea"> & ControlStyle) {
  const guarded = useGuardedInput<HTMLTextAreaElement>({ ...props, constraint });
  return (
    <textarea
      {...props}
      {...guarded}
      className={unstyled ? className : `text-control ${className}`}
      data-mono={mono || undefined}
    />
  );
}
