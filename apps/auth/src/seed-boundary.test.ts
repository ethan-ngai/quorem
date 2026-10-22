import { describe, expect, it, vi } from "vitest";
const { config, createAuth } = vi.hoisted(() => ({
  config: {
    method: "password",
    localPassword: false,
    database: "postgres://localhost/test",
    origin: "https://quorem.example",
  },
  createAuth: vi.fn(),
}));
vi.mock("./auth.ts", () => ({ config, createAuth, database: { query: vi.fn() } }));
import { seedAccounts } from "./seed-accounts";
describe("seed environment boundary", () => {
  it("rejects production credentials even with loopback databases before creating auth or users", async () => {
    await expect(
      seedAccounts("Long-test-password!", "postgres://localhost/product"),
    ).rejects.toThrow("Seeding requires local password mode");
    expect(createAuth).not.toHaveBeenCalled();
  });
});
