/** @file legacy-sql.ts @description PostgreSQL validation of lossless raw JSON ranges. @module judging */
import { sql, type SQL } from "drizzle-orm";
import type { Span } from "./legacy-case.ts";
export const legacyRaw = (value: Span): SQL =>
  sql`substring(source.raw FROM ${value.start + 1} FOR ${value.length})`;
export const legacyKind = (value: SQL): SQL =>
  sql`json_typeof(convert_from(${value},'UTF8')::json)`;
export const legacyInteger = (value: SQL): SQL =>
  sql`(${legacyKind(value)}='number' AND convert_from(${value},'UTF8') ~ '^(0|[1-9][0-9]*)$' AND CASE WHEN convert_from(${value},'UTF8') ~ '^(0|[1-9][0-9]*)$' THEN convert_from(${value},'UTF8')::numeric <= 2147483647 ELSE false END)`;
