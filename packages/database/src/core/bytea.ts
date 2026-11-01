/** @file core/bytea.ts @description PostgreSQL schema and migration ownership. @module database */
import { customType } from "drizzle-orm/pg-core";

export const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType: () => "bytea",
});
