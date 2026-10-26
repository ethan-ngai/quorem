/** @file participantColor.ts @description Account colors shared by avatars and collaborative presence. @module collaboration */
export const participantColors = Array.from(
  { length: 24 },
  (_, index) => `oklch(0.53 0.13 ${index * 15})`,
);
export function participantColor(userId: string, choice?: number) {
  if (choice && choice >= 1 && choice <= participantColors.length)
    return participantColors[choice - 1]!;
  let hash = 2166136261;
  for (const character of userId) hash = Math.imul(hash ^ character.codePointAt(0)!, 16777619);
  return participantColors[(hash >>> 0) % participantColors.length]!;
}
