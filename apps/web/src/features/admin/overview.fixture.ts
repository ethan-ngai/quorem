/** @file overview.fixture.ts @description Illustrative local administrator overview for UI checks. @module admin */
import type { AdminOverview } from "@quorem/contracts";

export const overviewFixture: AdminOverview = {
  generatedAt: "2026-11-05T20:30:00Z",
  windowStart: "2026-10-29T20:30:00Z",
  users: { accounts: 1248, administrators: 3, disabled: 2, active7d: 182 },
  content: { publications: 738, drafts: 27, workspaces: 3216 },
  submissions: { retained7d: 2841, pending: 4 },
  activeUsers: Array.from({ length: 8 }, (_, index) => ({
    id: `fixture-${index}`,
    displayName: [
      "Alex Chen",
      "Jordan Rivera",
      "Sam Patel",
      "Taylor Morgan",
      "Casey Williams",
      "Robin Kim",
      "Avery Robinson",
      "Morgan Lee",
    ][index],
    role: index === 2 ? "admin" : "user",
    disabled: index === 7,
    submissions: [42, 18, 7, 31, 12, 25, 9, 3][index],
    lastSubmittedAt: `2026-11-05T20:${29 - index}:00Z`,
  })),
  recentDrafts: [
    "Merge sorted lists",
    "Find the longest valid parentheses",
    "Department highest salary",
    "Serialize and deserialize binary tree",
    "Design a rate limiter",
  ].map((title, index) => ({
    id: `fixture-draft-${index}`,
    title,
    updatedAt: `2026-11-05T${19 - index}:30:00Z`,
    editingPublication: index === 1,
  })),
};
