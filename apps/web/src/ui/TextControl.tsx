import type { ComponentProps } from "react";
import "./text-control.css";

type ControlStyle = { mono?: boolean };

export function TextInput({
  mono,
  className = "",
  ...props
}: ComponentProps<"input"> & ControlStyle) {
  return <input {...props} className={`text-control ${className}`} data-mono={mono || undefined} />;
}

export function TextArea({
  mono,
  className = "",
  ...props
}: ComponentProps<"textarea"> & ControlStyle) {
  return (
    <textarea {...props} className={`text-control ${className}`} data-mono={mono || undefined} />
  );
}
