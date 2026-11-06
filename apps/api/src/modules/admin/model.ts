/** @file model.ts @description Read-only administrator overview port. @module admin */
export interface AdminOverview {
  generatedAt: string;
  windowStart: string;
  users: { accounts: number; administrators: number; disabled: number; active7d: number };
  content: { publications: number; drafts: number; workspaces: number };
  submissions: { retained7d: number; pending: number };
  activeUsers: {
    id: string;
    displayName: string;
    role: "admin" | "user";
    disabled: boolean;
    submissions: number;
    lastSubmittedAt: string;
  }[];
  recentDrafts: { id: string; title: string; updatedAt: string; editingPublication: boolean }[];
}

export interface AdminOverviewReader {
  /** Recheck live account authority before reading platform aggregates. */
  overview(userId: string): Promise<AdminOverview>;
}
