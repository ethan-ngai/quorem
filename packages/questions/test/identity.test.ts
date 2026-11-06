/** @file identity.test.ts @description Slug namespace budgets and deterministic publication identity. @module questions */
import { describe, expect, it } from "vitest";
import { questionPublicationSlug, questionSlugFits } from "../src/identity.ts";

describe("question slugs", () => {
  it("retains the full authored budget through private publication and subsequent edits", async () => {
    for (const length of [56, 80]) {
      const slug = "a".repeat(length);
      const published = await questionPublicationSlug(slug, "owner");
      expect(published).toMatch(/^private-[0-9a-f]{16}-/);
      expect(published).toHaveLength(length + 25);
      expect(questionSlugFits(published)).toBe(true);
      expect(await questionPublicationSlug(published, "owner")).toBe(published);
      expect(await questionPublicationSlug(published, null, "owner")).toBe(slug);
      expect(await questionPublicationSlug(slug, null)).toBe(slug);
    }
  });

  it("rejects over-budget authored and namespaced slugs and invalid public syntax", async () => {
    expect(questionSlugFits("a".repeat(81))).toBe(false);
    expect(questionSlugFits(`private-${"a".repeat(16)}-${"b".repeat(81)}`)).toBe(false);
    await expect(questionPublicationSlug("a".repeat(81), "owner")).rejects.toThrow("80");
    await expect(questionPublicationSlug("a".repeat(81), null)).rejects.toThrow("80");
    await expect(questionPublicationSlug("invalid_slug", null)).rejects.toThrow(
      "valid question slug",
    );
  });
});
