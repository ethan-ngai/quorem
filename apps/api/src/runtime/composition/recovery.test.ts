import { expect, it } from "vitest";
import { recoverAll } from "./recovery.ts";
it("attempts every capability even when a provider fails", async () => {
  const called: string[] = [];
  await expect(
    recoverAll([
      () => {
        called.push("wake");
        throw new Error("provider secret");
      },
      async () => {
        called.push("deadline");
      },
    ]),
  ).rejects.toThrow("Runtime recovery unavailable");
  expect(called).toEqual(["wake", "deadline"]);
});
