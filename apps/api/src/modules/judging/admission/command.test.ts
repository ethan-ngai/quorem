import { expect, it } from "vitest";
import { parseWorkspaceCommand } from "./command.ts";
it("bounds Go-encoded custom case bytes even when JSON escapes expand", async () => {
  const raw = `{"workspaceId":"00000000-0000-4000-8000-000000000001","kind":"run","source":"x","customCases":[{"args":["${"\\u0061".repeat(350000)}"]}]}`;
  await expect(parseWorkspaceCommand(raw, "key")).rejects.toMatchObject({ code: "invalid_input" });
}, 10000);
