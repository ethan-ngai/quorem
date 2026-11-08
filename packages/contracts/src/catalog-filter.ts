/** @file catalog-filter.ts @description Catalog query and question identifier schemas. @module contracts */
import { z } from "zod";

export const problemId = z.guid();
const selection = (item: z.ZodType) =>
  z
    .string()
    .refine((value) => {
      if (!value) return true;
      const items = value.split(",");
      return items.length <= 16 && items.every((entry) => item.safeParse(entry).success);
    })
    .default("");
const label = z
  .string()
  .refine((value) => value.length > 0 && !value.includes("\0") && Array.from(value).length <= 80);
const match = z.enum(["any", "all"]).optional();
export const catalogQuery = z.strictObject({
  q: z
    .string()
    .trim()
    .refine((value) => !value.includes("\0") && Array.from(value).length <= 120)
    .default(""),
  difficulty: selection(z.enum(["easy", "medium", "hard"])),
  topic: selection(label),
  topicMatch: match,
  company: selection(label),
  companyMatch: match,
  library: z.enum(["", "global", "private"]).default(""),
  type: z.enum(["", "classic", "odyssey"]).default(""),
  sql: z.enum(["", "true", "false"]).default(""),
  page: z.string().optional(),
  limit: z.string().optional(),
  sort: z.string().optional(),
  order: z.string().optional(),
});
