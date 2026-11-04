/** @file AuthoringFields.tsx @description Shared authoring field labels. @module admin */
import type { ReactNode } from "react";
/** @returns A labeled field that keeps native focus and keyboard behavior. */
export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="admin-field">
      <span>{label}</span>
      {children}
    </label>
  );
}
