/** @file factions.ts @description Team document, vote and presence storage. @module database */
import { sql } from "drizzle-orm";
import {
  pgTable,
  uuid,
  smallint,
  text,
  bigint,
  jsonb,
  timestamp,
  primaryKey,
  foreignKey,
  index,
  check,
} from "drizzle-orm/pg-core";
import { matches, workspaces, users } from "./index.ts";
export const match_teams = pgTable(
  "match_teams",
  {
    match_id: uuid().notNull(),
    team: smallint().notNull(),
    workspace_id: uuid(),
    source: text().notNull().default(""),
    document_version: bigint({ mode: "bigint" }).notNull().default(0n),
    document_epoch: uuid().notNull().defaultRandom(),
  },
  (t) => [
    primaryKey({ name: "match_teams_pkey", columns: [t.match_id, t.team] }),
    foreignKey({
      name: "match_teams_match_id_fkey",
      columns: [t.match_id],
      foreignColumns: [matches.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "match_teams_workspace_id_fkey",
      columns: [t.workspace_id],
      foreignColumns: [workspaces.id],
    }).onDelete("set null"),
    check("match_teams_team_check", sql`team BETWEEN 1 AND 4`),
    check("match_teams_document_version_check", sql`document_version >= 0`),
  ],
);
export const team_document_updates = pgTable(
  "team_document_updates",
  {
    match_id: uuid().notNull(),
    team: smallint().notNull(),
    epoch: uuid().notNull(),
    version: bigint({ mode: "bigint" }).notNull(),
    client_id: text().notNull(),
    changes: jsonb().notNull(),
  },
  (t) => [
    primaryKey({
      name: "team_document_updates_pkey",
      columns: [t.match_id, t.team, t.epoch, t.version],
    }),
    foreignKey({
      name: "team_document_updates_match_id_team_fkey",
      columns: [t.match_id, t.team],
      foreignColumns: [match_teams.match_id, match_teams.team],
    }).onDelete("cascade"),
    check("team_document_updates_version_check", sql`version > 0`),
  ],
);
export const team_votes = pgTable(
  "team_votes",
  {
    id: uuid().primaryKey(),
    match_id: uuid().notNull(),
    team: smallint().notNull(),
    vote: jsonb().notNull(),
    created_at: timestamp({ withTimezone: true, mode: "string" })
      .notNull()
      .default(sql`clock_timestamp()`),
  },
  (t) => [
    foreignKey({
      name: "team_votes_match_id_team_fkey",
      columns: [t.match_id, t.team],
      foreignColumns: [match_teams.match_id, match_teams.team],
    }).onDelete("cascade"),
    index("team_votes_team").on(t.match_id, t.team, t.created_at.desc()),
  ],
);
export const team_document_presence = pgTable(
  "team_document_presence",
  {
    match_id: uuid().notNull(),
    team: smallint().notNull(),
    owner_id: text().notNull(),
    client_id: text().notNull(),
    payload: jsonb().notNull(),
    expires_at: timestamp({ withTimezone: true, mode: "string" }).notNull(),
  },
  (t) => [
    primaryKey({
      name: "team_document_presence_pkey",
      columns: [t.match_id, t.team, t.owner_id, t.client_id],
    }),
    foreignKey({
      name: "team_document_presence_owner_id_fkey",
      columns: [t.owner_id],
      foreignColumns: [users.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "team_document_presence_match_id_team_fkey",
      columns: [t.match_id, t.team],
      foreignColumns: [match_teams.match_id, match_teams.team],
    }).onDelete("cascade"),
  ],
);
