/** @file AuthoringFields.tsx @description Shared authoring field labels. @module admin */
import type { ReactNode } from "react";
import { Tooltip } from "../../ui/Tooltip";
/** @returns A labeled field that keeps native focus and keyboard behavior. */
export function Field({
  label,
  icon,
  hint,
  unit,
  children,
}: {
  label: string;
  icon?: ReactNode;
  hint?: string;
  unit?: string;
  children: ReactNode;
}) {
  return (
    <label className="admin-field">
      <span className="admin-icon-label">
        {icon &&
          (hint ? (
            <Tooltip content={hint}>
              <span tabIndex={0} aria-label={hint} className="admin-field-icon">
                {icon}
              </span>
            </Tooltip>
          ) : (
            icon
          ))}
        {label}
        {unit && <span className="admin-field-unit mono-text">{unit}</span>}
      </span>
      {children}
    </label>
  );
}
