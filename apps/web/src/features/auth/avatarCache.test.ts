import { afterEach, expect, it, vi } from "vitest";
import {
  clearAvatarHint,
  invalidateAvatarHints,
  readAvatarHint,
  writeAvatarHint,
} from "./avatarCache";

afterEach(() => vi.unstubAllGlobals());
it("stores only a tab-local hint, rejects stale and unsafe values, and clears it", () => {
  const values = new Map<string, string>();
  vi.stubGlobal("sessionStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  });
  const shared = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => shared.get(key) ?? null,
    setItem: (key: string, value: string) => shared.set(key, value),
  });
  writeAvatarHint({ userId: "a", name: "Alice", color: 2 });
  expect(readAvatarHint()?.name).toBe("Alice");
  shared.set("quorem.avatar-hint-epoch.v1", "changed-in-another-tab");
  expect(readAvatarHint()).toBeUndefined();
  writeAvatarHint({ userId: "a", name: "Alice" });
  invalidateAvatarHints();
  expect(readAvatarHint()).toBeUndefined();
  writeAvatarHint({ userId: "a", name: "Alice", image: "https://other.example/image" });
  expect(readAvatarHint()).toBeUndefined();
  values.set(
    "quorem.avatar-hint.v1",
    JSON.stringify({ userId: "a", name: "Alice", savedAt: Date.now() - 86_400_001 }),
  );
  expect(readAvatarHint()).toBeUndefined();
  clearAvatarHint();
  expect(values.size).toBe(0);
});
