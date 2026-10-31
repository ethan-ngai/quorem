/** @file verification.ts @description Fenced verification challenges and persisted case evidence. @module database */
import {
  pgTable,
  uuid,
  text,
  integer,
  check,
  primaryKey,
  foreignKey,
  unique,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { bytea } from "../../core/bytea.ts";
import { execution_completion_staging, execution_jobs } from "./index.ts";
import { runner_job_input_cases } from "./runner-inputs.ts";
export const execution_verification_challenges = pgTable(
  "execution_verification_challenges",
  {
    id: uuid().primaryKey().notNull(),
    job_id: uuid().notNull(),
    attempt_id: uuid().notNull(),
    sandbox_scope: text().notNull(),
    job_data: text().notNull(),
    result_channel: text().notNull(),
    result_ordinal: integer().notNull(),
    ordinal: integer().notNull(),
    channel: text().notNull(),
    frame_hash: bytea().notNull(),
    raw_status: text().notNull(),
  },
  (t) => [
    foreignKey({
      columns: [t.job_id],
      foreignColumns: [execution_completion_staging.job_id],
      name: "execution_verification_challenges_job_id_fkey",
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.job_id, t.ordinal],
      foreignColumns: [runner_job_input_cases.job_id, runner_job_input_cases.ordinal],
      name: "execution_verification_challenges_job_id_ordinal_fkey",
    }),
    unique("execution_verification_challenges_job_id_ordinal_key").on(t.job_id, t.ordinal),
    check(
      "execution_verification_challenges_result_channel_check",
      sql`result_channel IN ('public','sample','private')`,
    ),
    check(
      "execution_verification_challenges_result_ordinal_check",
      sql`result_ordinal BETWEEN 0 AND 2147483646`,
    ),
    check("execution_verification_challenges_ordinal_check", sql`ordinal BETWEEN 0 AND 2147483646`),
    check(
      "execution_verification_challenges_channel_check",
      sql`channel IN ('public','sample','private')`,
    ),
    check("execution_verification_challenges_frame_hash_check", sql`octet_length(frame_hash)=32`),
  ],
);
export const execution_verification_output_chunks = pgTable(
  "execution_verification_output_chunks",
  {
    challenge_id: uuid().notNull(),
    field: text().notNull(),
    ordinal: integer().notNull(),
    data: bytea().notNull(),
    hash: bytea().notNull(),
  },
  (t) => [
    primaryKey({
      columns: [t.challenge_id, t.field, t.ordinal],
      name: "execution_verification_output_chunks_pkey",
    }),
    foreignKey({
      columns: [t.challenge_id],
      foreignColumns: [execution_verification_challenges.id],
      name: "execution_verification_output_chunks_challenge_id_fkey",
    }).onDelete("cascade"),
    check("execution_verification_output_chunks_field_check", sql`field IN ('actual','expected')`),
    check("execution_verification_output_chunks_ordinal_check", sql`ordinal>=0`),
    check(
      "execution_verification_output_chunks_data_check",
      sql`octet_length(data) BETWEEN 1 AND 65536`,
    ),
    check("execution_verification_output_chunks_hash_check", sql`hash=sha256(data)`),
  ],
);
export const execution_verified_cases = pgTable(
  "execution_verified_cases",
  {
    job_id: uuid().notNull(),
    ordinal: integer().notNull(),
    attempt_id: uuid().notNull(),
    sandbox_scope: text().notNull(),
    challenge_id: uuid().notNull(),
    binding: bytea().notNull(),
    frame_hash: bytea().notNull(),
    actual_hash: bytea(),
    expected_hash: bytea(),
    status: text().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.job_id, t.ordinal], name: "execution_verified_cases_pkey" }),
    foreignKey({
      columns: [t.job_id],
      foreignColumns: [execution_jobs.id],
      name: "execution_verified_cases_job_id_fkey",
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.job_id, t.ordinal],
      foreignColumns: [runner_job_input_cases.job_id, runner_job_input_cases.ordinal],
      name: "execution_verified_cases_job_id_ordinal_fkey",
    }),
    check("execution_verified_cases_binding_check", sql`octet_length(binding)=32`),
    check("execution_verified_cases_frame_hash_check", sql`octet_length(frame_hash)=32`),
    check(
      "execution_verified_cases_actual_hash_check",
      sql`actual_hash IS NULL OR octet_length(actual_hash)=32`,
    ),
    check(
      "execution_verified_cases_expected_hash_check",
      sql`expected_hash IS NULL OR octet_length(expected_hash)=32`,
    ),
    check(
      "execution_verified_cases_status_check",
      sql`status IN ('accepted','wrong_answer','executed','syntax_error','runtime_error','time_limit','memory_limit','output_limit','invalid_output')`,
    ),
  ],
);
