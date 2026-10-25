/** @file participantColor.ts @description Stable identity colors shared by avatars, cursors and selections. @module collaboration */
export function participantColor(userId: string) {
  let hash = 2166136261;
  for (const character of userId) hash = Math.imul(hash ^ character.codePointAt(0)!, 16777619);
  return `oklch(0.53 0.15 ${(hash >>> 0) % 360})`;
}
