/** Capitalize word initials while preserving existing uppercase letters. */
export function formatLabel(value: string): string {
  return value.replace(/[-_]/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}
