/** @file runner-inputs.ts @description Immutable content-addressed runner inputs. @module database */
import {
  pgTable,
  text,
  uuid,
  integer,
  boolean,
  primaryKey,
  foreignKey,
  check,
  index,
  type PgTableExtraConfigValue,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { bytea } from "../../core/bytea.ts";
import {
  interviews,
  problem_versions,
  interview_question_snapshots,
  execution_jobs,
} from "./index.ts";

export const runner_input_blobs = pgTable(
  "runner_input_blobs",
  { hash: bytea("hash").primaryKey().notNull(), data: bytea("data").notNull() },
  (_t): PgTableExtraConfigValue[] => [
    check("runner_input_blobs_hash_check", sql`octet_length(hash)=32 AND hash=sha256(data)`),
  ],
);
export const runner_version_inputs = pgTable(
  "runner_version_inputs",
  {
    version_id: uuid().primaryKey().notNull(),
    metadata_hash: bytea("metadata_hash").notNull(),
    fixture_hash: bytea("fixture_hash").notNull(),
    sealed: boolean().default(false).notNull(),
  },
  (t): PgTableExtraConfigValue[] => [
    foreignKey({
      columns: [t.version_id],
      foreignColumns: [problem_versions.id],
      name: "runner_version_inputs_version_id_fkey",
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.metadata_hash],
      foreignColumns: [runner_input_blobs.hash],
      name: "runner_version_inputs_metadata_hash_fkey",
    }),
    check("runner_version_inputs_fixture_hash_check", sql`octet_length(fixture_hash)=32`),
    index("runner_version_inputs_metadata_hash_idx").on(t.metadata_hash),
  ],
);
export const runner_snapshot_inputs = pgTable(
  "runner_snapshot_inputs",
  {
    session_id: uuid().notNull(),
    fixture_id: bytea("fixture_id").notNull(),
    metadata_hash: bytea("metadata_hash").notNull(),
    fixture_hash: bytea("fixture_hash").notNull(),
    sealed: boolean().default(false).notNull(),
  },
  (t): PgTableExtraConfigValue[] => [
    primaryKey({ columns: [t.session_id, t.fixture_id], name: "runner_snapshot_inputs_pkey" }),
    foreignKey({
      columns: [t.session_id, t.fixture_id],
      foreignColumns: [interview_question_snapshots.session_id, interview_question_snapshots.id],
      name: "runner_snapshot_inputs_session_id_fixture_id_fkey",
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.metadata_hash],
      foreignColumns: [runner_input_blobs.hash],
      name: "runner_snapshot_inputs_metadata_hash_fkey",
    }),
    check("runner_snapshot_inputs_fixture_hash_check", sql`octet_length(fixture_hash)=32`),
    index("runner_snapshot_inputs_metadata_hash_idx").on(t.metadata_hash),
  ],
);
export const runner_version_input_cases = pgTable(
  "runner_version_input_cases",
  {
    version_id: uuid().notNull(),
    channel: text().notNull(),
    stage: integer().notNull(),
    ordinal: integer().notNull(),
    blob_hash: bytea("blob_hash").notNull(),
  },
  (t): PgTableExtraConfigValue[] => [
    primaryKey({
      columns: [t.version_id, t.channel, t.stage, t.ordinal],
      name: "runner_version_input_cases_pkey",
    }),
    foreignKey({
      columns: [t.version_id],
      foreignColumns: [runner_version_inputs.version_id],
      name: "runner_version_input_cases_version_id_fkey",
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.blob_hash],
      foreignColumns: [runner_input_blobs.hash],
      name: "runner_version_input_cases_blob_hash_fkey",
    }),
    check("runner_version_input_cases_channel_check", sql`channel IN ('example','hidden')`),
    check("runner_version_input_cases_stage_check", sql`stage >= 0`),
    check("runner_version_input_cases_ordinal_check", sql`ordinal >= 0`),
    index("runner_version_input_cases_blob_hash_idx").on(t.blob_hash),
  ],
);
export const runner_snapshot_input_cases = pgTable(
  "runner_snapshot_input_cases",
  {
    session_id: uuid().notNull(),
    fixture_id: bytea("fixture_id").notNull(),
    channel: text().notNull(),
    stage: integer().notNull(),
    ordinal: integer().notNull(),
    blob_hash: bytea("blob_hash").notNull(),
  },
  (t): PgTableExtraConfigValue[] => [
    primaryKey({
      columns: [t.session_id, t.fixture_id, t.channel, t.stage, t.ordinal],
      name: "runner_snapshot_input_cases_pkey",
    }),
    foreignKey({
      columns: [t.session_id, t.fixture_id],
      foreignColumns: [runner_snapshot_inputs.session_id, runner_snapshot_inputs.fixture_id],
      name: "runner_snapshot_input_cases_session_id_fixture_id_fkey",
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.blob_hash],
      foreignColumns: [runner_input_blobs.hash],
      name: "runner_snapshot_input_cases_blob_hash_fkey",
    }),
    check("runner_snapshot_input_cases_channel_check", sql`channel IN ('example','hidden')`),
    check("runner_snapshot_input_cases_stage_check", sql`stage >= 0`),
    check("runner_snapshot_input_cases_ordinal_check", sql`ordinal >= 0`),
    index("runner_snapshot_input_cases_blob_hash_idx").on(t.blob_hash),
  ],
);
export const runner_job_inputs = pgTable(
  "runner_job_inputs",
  {
    job_id: uuid().primaryKey().notNull(),
    version_id: uuid(),
    session_id: uuid(),
    fixture_id: bytea("fixture_id"),
    metadata_hash: bytea("metadata_hash").notNull(),
    source_hash: bytea("source_hash").notNull(),
    runtime_revision: text().notNull(),
    harness_revision: text().notNull(),
    case_count: integer().notNull(),
    sample_count: integer().notNull(),
    private_details: boolean().notNull(),
    submit_cases_are_samples: boolean().notNull(),
    sealed: boolean().default(false).notNull(),
  },
  (t): PgTableExtraConfigValue[] => [
    foreignKey({
      columns: [t.job_id],
      foreignColumns: [execution_jobs.id],
      name: "runner_job_inputs_job_id_fkey",
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.version_id],
      foreignColumns: [runner_version_inputs.version_id],
      name: "runner_job_inputs_version_id_fkey",
    }),
    foreignKey({
      columns: [t.session_id, t.fixture_id],
      foreignColumns: [runner_snapshot_inputs.session_id, runner_snapshot_inputs.fixture_id],
      name: "runner_job_inputs_session_id_fixture_id_fkey",
    }),
    foreignKey({
      columns: [t.metadata_hash],
      foreignColumns: [runner_input_blobs.hash],
      name: "runner_job_inputs_metadata_hash_fkey",
    }),
    foreignKey({
      columns: [t.source_hash],
      foreignColumns: [runner_input_blobs.hash],
      name: "runner_job_inputs_source_hash_fkey",
    }),
    index("runner_job_inputs_source_hash_idx").on(t.source_hash),
    check("runner_job_inputs_source_hash_check", sql`octet_length(source_hash)=32`),
    check("runner_job_inputs_case_count_check", sql`case_count BETWEEN 0 AND 320`),
    check("runner_job_inputs_sample_count_check", sql`sample_count BETWEEN 0 AND 320`),
    check(
      "runner_job_inputs_check",
      sql`case_count + CASE WHEN submit_cases_are_samples THEN 0 ELSE sample_count END <= 320`,
    ),
    check(
      "runner_job_inputs_check1",
      sql`NOT submit_cases_are_samples OR (private_details AND case_count=sample_count)`,
    ),
    check(
      "runner_job_inputs_check2",
      sql`(version_id IS NOT NULL AND session_id IS NULL AND fixture_id IS NULL) OR (version_id IS NULL AND session_id IS NOT NULL AND fixture_id IS NOT NULL)`,
    ),
    index("runner_job_inputs_metadata_hash_idx").on(t.metadata_hash),
  ],
);
export const runner_job_input_cases = pgTable(
  "runner_job_input_cases",
  {
    job_id: uuid().notNull(),
    ordinal: integer().notNull(),
    channel: text().notNull(),
    blob_hash: bytea("blob_hash").notNull(),
  },
  (t): PgTableExtraConfigValue[] => [
    primaryKey({ columns: [t.job_id, t.ordinal], name: "runner_job_input_cases_pkey" }),
    foreignKey({
      columns: [t.job_id],
      foreignColumns: [runner_job_inputs.job_id],
      name: "runner_job_input_cases_job_id_fkey",
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.blob_hash],
      foreignColumns: [runner_input_blobs.hash],
      name: "runner_job_input_cases_blob_hash_fkey",
    }),
    check("runner_job_input_cases_ordinal_check", sql`ordinal BETWEEN 0 AND 319`),
    check("runner_job_input_cases_channel_check", sql`channel IN ('public','sample','private')`),
    index("runner_job_input_cases_blob_hash_idx").on(t.blob_hash),
  ],
);
export const interview_active_runner_inputs = pgTable(
  "interview_active_runner_inputs",
  {
    session_id: uuid().primaryKey().notNull(),
    question_epoch: uuid().notNull(),
    fixture_id: bytea("fixture_id").notNull(),
  },
  (t): PgTableExtraConfigValue[] => [
    foreignKey({
      columns: [t.session_id],
      foreignColumns: [interviews.id],
      name: "interview_active_runner_inputs_session_id_fkey",
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.session_id, t.fixture_id],
      foreignColumns: [runner_snapshot_inputs.session_id, runner_snapshot_inputs.fixture_id],
      name: "interview_active_runner_inputs_session_id_fixture_id_fkey",
    }),
  ],
);
