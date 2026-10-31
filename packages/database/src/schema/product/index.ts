import { pgTable, text, foreignKey, timestamp, index, unique, uuid, integer, boolean, check, bigserial, bigint, doublePrecision, type AnyPgColumn, type PgTableExtraConfigValue, uniqueIndex, jsonb, primaryKey } from "drizzle-orm/pg-core"
import { sql } from "drizzle-orm"
import { bytea } from "../../core/bytea.ts"



export const schema_migrations = pgTable("schema_migrations", {
	name: text().primaryKey().notNull(),
});

export const access_audit = pgTable("access_audit", {
	operation_id: text().primaryKey().notNull(),
	actor: text().notNull(),
	user_id: text().notNull(),
	action: text().notNull(),
	scope: text().notNull(),
	reason: text().notNull(),
	occurred_at: timestamp({ withTimezone: true, mode: 'string' }).default(sql`clock_timestamp()`).notNull(),
}, (table): PgTableExtraConfigValue[] => [
	foreignKey({
			columns: [table.user_id],
			foreignColumns: [users.id],
			name: "access_audit_user_id_fkey"
		}),
]);

export const execution_jobs = pgTable("execution_jobs", {
	id: uuid().primaryKey().notNull(),
	submission_id: uuid().notNull(),
	attempt_id: uuid(),
	attempts: integer().default(0).notNull(),
	available_at: timestamp({ withTimezone: true, mode: 'string' }).default(sql`clock_timestamp()`).notNull(),
	lease_until: timestamp({ withTimezone: true, mode: 'string' }),
	finished: boolean().default(false).notNull(),
	language: text().default('python').notNull(),
	runtime_revision: text().default('python-3.12-v1').notNull(),
	harness_revision: text().default('quorem-harness-v2').notNull(),
	attempt_started_at: timestamp({ withTimezone: true, mode: 'string' }),
}, (table): PgTableExtraConfigValue[] => [
	index("jobs_claim").using("btree", table.available_at.asc().nullsLast().op("timestamptz_ops")).where(sql`(NOT finished)`),
	foreignKey({
			columns: [table.submission_id],
			foreignColumns: [submissions.id],
			name: "execution_jobs_submission_id_fkey"
		}),
	unique("execution_jobs_submission_id_key").on(table.submission_id),
]);

export const entitlement_grants = pgTable("entitlement_grants", {
	id: uuid().primaryKey().notNull(),
	user_id: text().notNull(),
	feature: text().notNull(),
	source: text().notNull(),
	source_ref: text().notNull(),
	valid_from: timestamp({ withTimezone: true, mode: 'string' }).default(sql`clock_timestamp()`).notNull(),
	expires_at: timestamp({ withTimezone: true, mode: 'string' }),
	revoked_at: timestamp({ withTimezone: true, mode: 'string' }),
	actor: text().notNull(),
	reason: text().notNull(),
}, (table): PgTableExtraConfigValue[] => [
	index("entitlement_grants_unrevoked").using("btree", table.user_id.asc().nullsLast().op("text_ops"), table.feature.asc().nullsLast().op("text_ops")).where(sql`(revoked_at IS NULL)`),
	foreignKey({
			columns: [table.user_id],
			foreignColumns: [users.id],
			name: "entitlement_grants_user_id_fkey"
		}),
	unique("entitlement_grants_user_id_feature_source_source_ref_key").on(table.user_id, table.feature, table.source, table.source_ref),
	check("entitlement_grants_feature_check", sql`feature = ANY (ARRAY['internal'::text, 'matches.host_guests'::text, 'intelligence.hosted'::text, 'experimental'::text, 'interviews.host'::text, 'questions.custom'::text])`),
	check("entitlement_grants_source_check", sql`source = ANY (ARRAY['manual'::text, 'internal'::text, 'subscription'::text])`),
]);

export const guest_sessions = pgTable("guest_sessions", {
	token_hash: text().primaryKey().notNull(),
	owner_id: text().notNull(),
	match_id: uuid().notNull(),
	created_at: timestamp({ withTimezone: true, mode: 'string' }).default(sql`clock_timestamp()`).notNull(),
	last_seen_at: timestamp({ withTimezone: true, mode: 'string' }).default(sql`clock_timestamp()`).notNull(),
	expires_at: timestamp({ withTimezone: true, mode: 'string' }).notNull(),
	revoked_at: timestamp({ withTimezone: true, mode: 'string' }),
}, (table): PgTableExtraConfigValue[] => [
	index("guest_sessions_expiry").using("btree", table.expires_at.asc().nullsLast().op("timestamptz_ops")),
	foreignKey({
			columns: [table.match_id],
			foreignColumns: [matches.id],
			name: "guest_sessions_match_id_fkey"
		}),
	foreignKey({
			columns: [table.owner_id],
			foreignColumns: [users.id],
			name: "guest_sessions_owner_id_fkey"
		}),
	unique("guest_sessions_owner_id_key").on(table.owner_id),
]);

export const guest_sponsor_locks = pgTable("guest_sponsor_locks", {
	user_id: text().primaryKey().notNull(),
}, (table): PgTableExtraConfigValue[] => [
	foreignKey({
			columns: [table.user_id],
			foreignColumns: [users.id],
			name: "guest_sponsor_locks_user_id_fkey"
		}),
]);

export const interview_guest_sessions = pgTable("interview_guest_sessions", {
	token_hash: text().primaryKey().notNull(),
	owner_id: text().notNull(),
	session_id: uuid().notNull(),
	expires_at: timestamp({ withTimezone: true, mode: 'string' }).default(sql`(clock_timestamp() + '24:00:00'::interval)`).notNull(),
	revoked_at: timestamp({ withTimezone: true, mode: 'string' }),
}, (table): PgTableExtraConfigValue[] => [
	index("interview_guest_sessions_session").using("btree", table.session_id.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.owner_id],
			foreignColumns: [users.id],
			name: "interview_guest_sessions_owner_id_fkey"
		}),
	foreignKey({
			columns: [table.session_id],
			foreignColumns: [interviews.id],
			name: "interview_guest_sessions_session_id_fkey"
		}).onDelete("cascade"),
	unique("interview_guest_sessions_owner_id_key").on(table.owner_id),
]);

export const interview_outbox = pgTable("interview_outbox", {
	sequence: bigserial({ mode: "bigint" }).primaryKey().notNull(),
	id: uuid().defaultRandom().notNull(),
	session_id: uuid().notNull(),
	event_type: text().notNull(),
	occurred_at: timestamp({ withTimezone: true, mode: 'string' }).default(sql`clock_timestamp()`).notNull(),
	published_at: timestamp({ withTimezone: true, mode: 'string' }),
}, (table): PgTableExtraConfigValue[] => [
	index("interview_outbox_pending").using("btree", table.sequence.asc().nullsLast().op("int8_ops")).where(sql`(published_at IS NULL)`),
	index("interview_outbox_retention").using("btree", table.occurred_at.asc().nullsLast().op("int8_ops"), table.sequence.asc().nullsLast().op("int8_ops")).where(sql`(published_at IS NOT NULL)`),
	foreignKey({
			columns: [table.session_id],
			foreignColumns: [interviews.id],
			name: "interview_outbox_session_id_fkey"
		}).onDelete("cascade"),
	unique("interview_outbox_id_key").on(table.id),
]);

export const interview_rule_events = pgTable("interview_rule_events", {
	id: uuid().primaryKey().notNull(),
	session_id: uuid().notNull(),
	owner_id: text().notNull(),
	kind: text().notNull(),
	occurred_at: timestamp({ withTimezone: true, mode: 'string' }).default(sql`clock_timestamp()`).notNull(),
}, (table): PgTableExtraConfigValue[] => [
	index("interview_rule_events_actor").using("btree", table.session_id.asc().nullsLast().op("text_ops"), table.owner_id.asc().nullsLast().op("uuid_ops"), table.kind.asc().nullsLast().op("timestamptz_ops"), table.occurred_at.desc().nullsFirst().op("timestamptz_ops")),
	index("interview_rule_events_recent").using("btree", table.session_id.asc().nullsLast().op("timestamptz_ops"), table.occurred_at.desc().nullsFirst().op("timestamptz_ops"), table.id.desc().nullsFirst().op("timestamptz_ops")),
	foreignKey({
			columns: [table.owner_id],
			foreignColumns: [users.id],
			name: "interview_rule_events_owner_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.session_id],
			foreignColumns: [interviews.id],
			name: "interview_rule_events_session_id_fkey"
		}).onDelete("cascade"),
	check("interview_rule_events_kind_check", sql`kind = ANY (ARRAY['paste'::text, 'focus'::text])`),
]);

export const match_outbox = pgTable("match_outbox", {
	sequence: bigint({ mode: "bigint" }).primaryKey().generatedAlwaysAsIdentity({ name: "match_outbox_sequence_seq", startWith: 1, increment: 1, minValue: 1, maxValue: "9223372036854775807", cache: 1 }),
	id: uuid().notNull(),
	match_id: uuid().notNull(),
	version: bigint({ mode: "bigint" }).notNull(),
	event_type: text().notNull(),
	occurred_at: timestamp({ withTimezone: true, mode: 'string' }).default(sql`clock_timestamp()`).notNull(),
	published_at: timestamp({ withTimezone: true, mode: 'string' }),
}, (table): PgTableExtraConfigValue[] => [
	index("match_outbox_retention").using("btree", table.occurred_at.asc().nullsLast().op("int8_ops"), table.sequence.asc().nullsLast().op("int8_ops")).where(sql`(published_at IS NOT NULL)`),
	index("unpublished_match_events").using("btree", table.sequence.asc().nullsLast().op("int8_ops")).where(sql`(published_at IS NULL)`),
	foreignKey({
			columns: [table.match_id],
			foreignColumns: [matches.id],
			name: "match_outbox_match_id_fkey"
		}),
	unique("match_outbox_id_key").on(table.id),
	unique("match_outbox_match_id_version_key").on(table.match_id, table.version),
	check("match_outbox_event_type_check", sql`event_type = ANY (ARRAY['match.updated'::text, 'match.completed'::text])`),
]);

export const match_reservations = pgTable("match_reservations", {
	owner_id: text().primaryKey().notNull(),
	match_id: uuid().notNull(),
}, (table): PgTableExtraConfigValue[] => [
	index("match_reservations_match").using("btree", table.match_id.asc().nullsLast().op("text_ops"), table.owner_id.asc().nullsLast().op("text_ops")),
	foreignKey({
			columns: [table.match_id],
			foreignColumns: [matches.id],
			name: "match_reservations_match_id_fkey"
		}),
	foreignKey({
			columns: [table.owner_id],
			foreignColumns: [users.id],
			name: "match_reservations_owner_id_fkey"
		}),
]);

export const match_rule_events = pgTable("match_rule_events", {
	id: uuid().primaryKey().notNull(),
	match_id: uuid().notNull(),
	owner_id: text().notNull(),
	kind: text().notNull(),
	occurred_at: timestamp({ withTimezone: true, mode: 'string' }).default(sql`clock_timestamp()`).notNull(),
}, (table): PgTableExtraConfigValue[] => [
	index("match_rule_events_match").using("btree", table.match_id.asc().nullsLast().op("timestamptz_ops"), table.occurred_at.asc().nullsLast().op("timestamptz_ops")),
	foreignKey({
			columns: [table.match_id],
			foreignColumns: [matches.id],
			name: "match_rule_events_match_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.owner_id],
			foreignColumns: [users.id],
			name: "match_rule_events_owner_id_fkey"
		}),
	check("match_rule_events_kind_check", sql`kind = ANY (ARRAY['clipboard'::text, 'focus'::text])`),
]);

export const realtime_presence_leases = pgTable("realtime_presence_leases", {
	id: uuid().primaryKey().notNull(),
	topic: text().notNull(),
	subject: text().notNull(),
	expires_at: timestamp({ withTimezone: true, mode: 'string' }).notNull(),
}, (table): PgTableExtraConfigValue[] => [
	index("realtime_presence_expiry").using("btree", table.expires_at.asc().nullsLast().op("timestamptz_ops")),
	index("realtime_presence_subject").using("btree", table.topic.asc().nullsLast().op("timestamptz_ops"), table.subject.asc().nullsLast().op("text_ops"), table.expires_at.asc().nullsLast().op("text_ops")),
	check("realtime_presence_leases_check", sql`(length(topic) <= 128) AND (length(subject) <= 128)`),
]);

export const maintenance_schedule = pgTable("maintenance_schedule", {
	task: text().primaryKey().notNull(),
	next_run_at: timestamp({ withTimezone: true, mode: 'string' }).notNull(),
});

export const users = pgTable("users", {
	id: text().primaryKey().notNull(),
	display_name: text().notNull(),
	admission_tokens: doublePrecision().default(2).notNull(),
	tokens_updated_at: timestamp({ withTimezone: true, mode: 'string' }).default(sql`clock_timestamp()`).notNull(),
	participant_id: uuid().defaultRandom().notNull(),
	role: text().default('user').notNull(),
	disabled: boolean().default(false).notNull(),
	kind: text().default('account').notNull(),
	profile_image: text().default('').notNull(),
	profile_color: integer().default(0).notNull(),
	profile_color_revision: bigint({ mode: "bigint" }).default(0n).notNull(),
}, (table): PgTableExtraConfigValue[] => [
	unique("users_participant_id_key").on(table.participant_id),
	check("users_kind_check", sql`kind = ANY (ARRAY['account'::text, 'guest'::text])`),
	check("users_role_check", sql`role = ANY (ARRAY['user'::text, 'admin'::text])`),
	check("users_profile_color_check", sql`(profile_color >= 0) AND (profile_color <= 24)`),
]);

export const problems = pgTable("problems", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	slug: text().notNull(),
	current_version_id: uuid(),
	owner_id: text(),
	leetcode_id: integer(),
}, (table): PgTableExtraConfigValue[] => [
	uniqueIndex("problems_leetcode_id").using("btree", table.leetcode_id.asc().nullsLast().op("int4_ops")).where(sql`(leetcode_id IS NOT NULL)`),
	index("problems_private_owner").using("btree", table.owner_id.asc().nullsLast().op("text_ops")).where(sql`(owner_id IS NOT NULL)`),
	foreignKey({
			columns: [table.id, table.current_version_id],
			foreignColumns: [problem_versions.problem_id, problem_versions.id],
			name: "current_publication_identity"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.owner_id],
			foreignColumns: [users.id],
			name: "problems_owner_id_fkey"
		}),
	unique("problems_slug_key").on(table.slug),
	check("problems_leetcode_id_check", sql`leetcode_id > 0`),
]);

export const companies = pgTable("companies", {
	id: bigint({ mode: "bigint" }).primaryKey().generatedAlwaysAsIdentity({ name: "companies_id_seq", startWith: 1, increment: 1, minValue: 1, maxValue: "9223372036854775807", cache: 1 }),
	name: text().notNull(),
}, (table): PgTableExtraConfigValue[] => [
	uniqueIndex("companies_name_ci").using("btree", sql`lower(name)`),
	check("companies_name_check", sql`(name = btrim(name)) AND ((length(name) >= 1) AND (length(name) <= 80)) AND (POSITION((','::text) IN (name)) = 0)`),
]);

export const workspaces = pgTable("workspaces", {
	id: uuid().primaryKey().notNull(),
	owner_id: text().notNull(),
	problem_version_id: uuid().notNull(),
	language: text().notNull(),
	kind: text().default('solo').notNull(),
	updated_at: timestamp({ withTimezone: true, mode: 'string' }).default(sql`clock_timestamp()`).notNull(),
	match_id: uuid(),
}, (table): PgTableExtraConfigValue[] => [
	uniqueIndex("match_workspace_owner_language").using("btree", table.match_id.asc().nullsLast().op("text_ops"), table.owner_id.asc().nullsLast().op("text_ops"), table.language.asc().nullsLast().op("uuid_ops")).where(sql`(kind = 'match'::text)`),
	uniqueIndex("solo_workspace").using("btree", table.owner_id.asc().nullsLast().op("text_ops"), table.problem_version_id.asc().nullsLast().op("text_ops"), table.language.asc().nullsLast().op("text_ops")).where(sql`(kind = 'solo'::text)`),
	foreignKey({
			columns: [table.match_id],
			foreignColumns: [matches.id],
			name: "workspaces_match_id_fkey"
		}),
	foreignKey({
			columns: [table.owner_id],
			foreignColumns: [users.id],
			name: "workspaces_owner_id_fkey"
		}),
	foreignKey({
			columns: [table.problem_version_id, table.language],
			foreignColumns: [problem_languages.version_id, problem_languages.language],
			name: "workspace_problem_language_fkey"
		}),
	unique("workspace_owner_identity").on(table.id, table.owner_id),
	check("workspace_match_kind", sql`(kind = 'match'::text) = (match_id IS NOT NULL)`),
	check("workspaces_kind_check", sql`kind = ANY (ARRAY['solo'::text, 'match'::text])`),
	check("workspaces_language_check", sql`language = ANY (ARRAY['python'::text, 'java'::text, 'typescript'::text, 'ocaml'::text, 'postgresql'::text])`),
]);

export const submission_outbox = pgTable("submission_outbox", {
	sequence: bigint({ mode: "bigint" }).primaryKey().generatedAlwaysAsIdentity({ name: "submission_outbox_sequence_seq", startWith: 1, increment: 1, minValue: 1, maxValue: "9223372036854775807", cache: 1 }),
	id: uuid().defaultRandom().notNull(),
	submission_id: uuid().notNull(),
	occurred_at: timestamp({ withTimezone: true, mode: 'string' }).default(sql`clock_timestamp()`).notNull(),
	published_at: timestamp({ withTimezone: true, mode: 'string' }),
}, (table): PgTableExtraConfigValue[] => [
	index("submission_outbox_pending").using("btree", table.sequence.asc().nullsLast().op("int8_ops")).where(sql`(published_at IS NULL)`),
	index("submission_outbox_retention").using("btree", table.occurred_at.asc().nullsLast().op("int8_ops"), table.sequence.asc().nullsLast().op("int8_ops")).where(sql`(published_at IS NOT NULL)`),
	foreignKey({
			columns: [table.submission_id],
			foreignColumns: [submissions.id],
			name: "submission_outbox_submission_id_fkey"
		}).onDelete("cascade"),
	unique("submission_outbox_id_key").on(table.id),
]);

export const membership_outbox = pgTable("membership_outbox", {
	sequence: bigint({ mode: "bigint" }).primaryKey().generatedAlwaysAsIdentity({ name: "membership_outbox_sequence_seq", startWith: 1, increment: 1, minValue: 1, maxValue: "9223372036854775807", cache: 1 }),
	id: uuid().defaultRandom().notNull(),
	participant_id: uuid().notNull(),
	occurred_at: timestamp({ withTimezone: true, mode: 'string' }).default(sql`clock_timestamp()`).notNull(),
	published_at: timestamp({ withTimezone: true, mode: 'string' }),
}, (table): PgTableExtraConfigValue[] => [
	index("membership_outbox_retention").using("btree", table.occurred_at.asc().nullsLast().op("int8_ops"), table.sequence.asc().nullsLast().op("timestamptz_ops")).where(sql`(published_at IS NOT NULL)`),
	index("unpublished_membership_events").using("btree", table.sequence.asc().nullsLast().op("int8_ops")).where(sql`(published_at IS NULL)`),
	unique("membership_outbox_id_key").on(table.id),
]);

export const match_reconciliation_pending = pgTable("match_reconciliation_pending", {
	match_id: uuid().primaryKey().notNull(),
	generation: bigint({ mode: "bigint" }).default(1n).notNull(),
}, (table): PgTableExtraConfigValue[] => [
	foreignKey({
			columns: [table.match_id],
			foreignColumns: [matches.id],
			name: "match_reconciliation_pending_match_id_fkey"
		}).onDelete("cascade"),
]);

export const matches = pgTable("matches", {
	id: uuid().primaryKey().notNull(),
	host_owner_id: text().notNull(),
	invite_hash: text().notNull(),
	expires_at: timestamp({ withTimezone: true, mode: 'string' }).notNull(),
	duration_minutes: integer().notNull(),
	state: text().notNull(),
	version: bigint({ mode: "bigint" }).default(0n).notNull(),
	admission_sequence: bigint({ mode: "bigint" }).default(0n).notNull(),
	problem_version_id: uuid(),
	started_at: timestamp({ withTimezone: true, mode: 'string' }),
	deadline: timestamp({ withTimezone: true, mode: 'string' }),
	finalizing_at: timestamp({ withTimezone: true, mode: 'string' }),
	outcome: jsonb(),
	reconciled_at: timestamp({ withTimezone: true, mode: 'string' }).default(sql`'-infinity'`).notNull(),
	mode: text().default('showdown').notNull(),
	difficulties: text().array().notNull(),
	selected_problem_version_id: uuid(),
	rules: jsonb().default({"focus":"off","clipboard":"off"}).notNull(),
	access_mode: text().default('accounts_only').notNull(),
	guest_joins: integer().default(0).notNull(),
	admission_locked: boolean().default(false).notNull(),
	question_filters: jsonb().default({}).notNull(),
}, (table): PgTableExtraConfigValue[] => [
	index("match_reconciliation_order").using("btree", table.reconciled_at.asc().nullsLast().op("timestamptz_ops"), table.id.asc().nullsLast().op("timestamptz_ops")).where(sql`(state <> ALL (ARRAY['completed'::text, 'cancelled'::text]))`),
	index("matches_reconcile").using("btree", table.state.asc().nullsLast().op("text_ops"), table.deadline.asc().nullsLast().op("text_ops"), table.expires_at.asc().nullsLast().op("text_ops")).where(sql`(state <> ALL (ARRAY['completed'::text, 'cancelled'::text]))`),
	foreignKey({
			columns: [table.host_owner_id],
			foreignColumns: [users.id],
			name: "matches_host_owner_id_fkey"
		}),
	foreignKey({
			columns: [table.problem_version_id],
			foreignColumns: [problem_versions.id],
			name: "matches_problem_version_id_fkey"
		}),
	foreignKey({
			columns: [table.selected_problem_version_id],
			foreignColumns: [problem_versions.id],
			name: "matches_selected_problem_version_id_fkey"
		}),
	unique("matches_invite_hash_key").on(table.invite_hash),
	check("matches_access_mode_check", sql`access_mode = ANY (ARRAY['accounts_only'::text, 'guests_allowed'::text])`),
	check("matches_check", sql`(started_at IS NULL) = (problem_version_id IS NULL)`),
	check("matches_check1", sql`(state = ANY (ARRAY['completed'::text, 'cancelled'::text])) = (outcome IS NOT NULL)`),
	check("matches_duration_minutes_check", sql`duration_minutes = ANY (ARRAY[15, 30, 45, 60])`),
	check("matches_mode_check", sql`mode = ANY (ARRAY['showdown'::text, 'free-for-all'::text])`),
	check("matches_state_check", sql`state = ANY (ARRAY['waiting'::text, 'ready'::text, 'active'::text, 'finalizing'::text, 'completed'::text, 'cancelled'::text])`),
	check("matches_difficulties_check", sql`((cardinality(difficulties) >= 1) AND (cardinality(difficulties) <= 3)) AND (difficulties <@ ARRAY['easy'::text, 'medium'::text, 'hard'::text]) AND (array_position(difficulties, NULL::text) IS NULL)`),
]);

export const execution_attempt_usage = pgTable("execution_attempt_usage", {
	attempt_id: uuid().primaryKey().notNull(),
	submission_id: uuid().notNull(),
	seconds: integer().notNull(),
	recorded_at: timestamp({ withTimezone: true, mode: 'string' }).default(sql`clock_timestamp()`).notNull(),
}, (table): PgTableExtraConfigValue[] => [
	foreignKey({
			columns: [table.submission_id],
			foreignColumns: [submissions.id],
			name: "execution_attempt_usage_submission_id_fkey"
		}).onDelete("cascade"),
	check("execution_attempt_usage_seconds_check", sql`seconds >= 0`),
]);

export const guest_execution_usage = pgTable("guest_execution_usage", {
	submission_id: uuid().primaryKey().notNull(),
	match_id: uuid().notNull(),
	sponsor_id: text().notNull(),
	reserved_seconds: integer().default(60).notNull(),
	charged_seconds: integer(),
	settled_at: timestamp({ withTimezone: true, mode: 'string' }),
	admitted_at: timestamp({ withTimezone: true, mode: 'string' }).default(sql`clock_timestamp()`).notNull(),
}, (table): PgTableExtraConfigValue[] => [
	index("guest_usage_active_sponsor").using("btree", table.sponsor_id.asc().nullsLast().op("text_ops")).where(sql`(settled_at IS NULL)`),
	index("guest_usage_room").using("btree", table.match_id.asc().nullsLast().op("uuid_ops")),
	index("guest_usage_sponsor").using("btree", table.sponsor_id.asc().nullsLast().op("timestamptz_ops"), table.admitted_at.asc().nullsLast().op("timestamptz_ops")),
	foreignKey({
			columns: [table.match_id],
			foreignColumns: [matches.id],
			name: "guest_execution_usage_match_id_fkey"
		}),
	foreignKey({
			columns: [table.sponsor_id],
			foreignColumns: [users.id],
			name: "guest_execution_usage_sponsor_id_fkey"
		}),
	foreignKey({
			columns: [table.submission_id],
			foreignColumns: [submissions.id],
			name: "guest_execution_usage_submission_id_fkey"
		}).onDelete("cascade"),
	check("guest_execution_usage_reserved_seconds_check", sql`reserved_seconds = 60`),
	check("guest_execution_usage_charged_seconds_check", sql`charged_seconds >= 0`),
]);

export const interview_execution = pgTable("interview_execution", {
	submission_id: uuid().primaryKey().notNull(),
	session_id: uuid().notNull(),
	document_version: bigint({ mode: "bigint" }).notNull(),
	document_epoch: uuid().notNull(),
	level: integer().default(1).notNull(),
	progress_scope: uuid(),
	question_epoch: uuid().notNull(),
	private_results: jsonb(),
	fixture_id: bytea("fixture_id").notNull(),
	private_results_payload: bytea("private_results_payload"),
}, (table): PgTableExtraConfigValue[] => [
	index("interview_execution_question").using("btree", table.session_id.asc().nullsLast().op("uuid_ops"), table.question_epoch.asc().nullsLast().op("uuid_ops"), table.submission_id.asc().nullsLast().op("uuid_ops")),
	index("interview_execution_session").using("btree", table.session_id.asc().nullsLast().op("uuid_ops"), table.submission_id.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.submission_id, table.session_id],
			foreignColumns: [submissions.id, submissions.interview_id],
			name: "interview_execution_submission_session_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.session_id, table.fixture_id],
			foreignColumns: [interview_question_snapshots.session_id, interview_question_snapshots.id],
			name: "interview_execution_fixture_fkey"
		}),
	unique("interview_execution_identity").on(table.submission_id, table.session_id),
]);

export const execution_checkpoints = pgTable("execution_checkpoints", {
	job_id: uuid().primaryKey().notNull(),
	last_attempt_id: uuid(),
	next_ordinal: integer().default(0).notNull(),
	artifact: jsonb(),
	compilation_nanos: bigint({ mode: "bigint" }).default(0n).notNull(),
	fatal: bytea("fatal"),
	definite_failures: integer().default(0).notNull(),
}, (table): PgTableExtraConfigValue[] => [
	foreignKey({
			columns: [table.job_id],
			foreignColumns: [execution_jobs.id],
			name: "execution_checkpoints_job_id_fkey"
		}).onDelete("cascade"),
	check("execution_checkpoints_next_ordinal_check", sql`(next_ordinal >= 0) AND (next_ordinal <= 320)`),
	check("execution_checkpoints_compilation_nanos_check", sql`(compilation_nanos >= 0) AND (compilation_nanos <= '120000000000'::bigint)`),
	check("execution_checkpoints_definite_failures_check", sql`(definite_failures >= 0) AND (definite_failures <= 320)`),
]);

export const question_drafts = pgTable("question_drafts", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	revision: bigint({ mode: "bigint" }).default(1n).notNull(),
	content: jsonb().notNull(),
	created_by: text().notNull(),
	updated_by: text().notNull(),
	updated_at: timestamp({ withTimezone: true, mode: 'string' }).default(sql`clock_timestamp()`).notNull(),
	published_version_id: uuid(),
	owner_id: text(),
	lossless_content: bytea("lossless_content"),
}, (table): PgTableExtraConfigValue[] => [
	index("question_drafts_created_by").using("btree", table.created_by.asc().nullsLast().op("text_ops")),
	index("question_drafts_private_owner").using("btree", table.owner_id.asc().nullsLast().op("timestamptz_ops"), table.updated_at.desc().nullsFirst().op("text_ops"), table.id.desc().nullsFirst().op("text_ops")),
	index("question_drafts_published_version").using("btree", table.published_version_id.asc().nullsLast().op("uuid_ops")),
	index("question_drafts_updated_at").using("btree", table.updated_at.desc().nullsFirst().op("timestamptz_ops"), table.id.asc().nullsLast().op("timestamptz_ops")),
	index("question_drafts_updated_by").using("btree", table.updated_by.asc().nullsLast().op("text_ops")),
	foreignKey({
			columns: [table.created_by],
			foreignColumns: [users.id],
			name: "question_drafts_created_by_fkey"
		}),
	foreignKey({
			columns: [table.owner_id],
			foreignColumns: [users.id],
			name: "question_drafts_owner_id_fkey"
		}),
	foreignKey({
			columns: [table.published_version_id],
			foreignColumns: [problem_versions.id],
			name: "question_drafts_published_version_id_fkey"
		}),
	foreignKey({
			columns: [table.updated_by],
			foreignColumns: [users.id],
			name: "question_drafts_updated_by_fkey"
		}),
	check("question_drafts_content_check", sql`(jsonb_typeof(content) = 'object'::text) AND (octet_length((content)::text) <= 4194304)`),
	check("question_drafts_revision_check", sql`revision > 0`),
]);

export const problem_versions = pgTable("problem_versions", {
	id: uuid().primaryKey().notNull(),
	version: integer().notNull(),
	problem_id: uuid().notNull(),
	title: text().notNull(),
	difficulty: text().notNull(),
	statement_markdown: text().notNull(),
	signature: jsonb().notNull(),
	constraints: jsonb().notNull(),
	limits: jsonb().notNull(),
	attribution: text().notNull(),
	sealed: boolean().default(false).notNull(),
	sql_config: jsonb(),
	odyssey: jsonb(),
	lossless_fixture: bytea("lossless_fixture"),
	lossless_public: bytea("lossless_public"),
	lossless_stages: bytea("lossless_stages"),
}, (table): PgTableExtraConfigValue[] => [
	foreignKey({
			columns: [table.problem_id],
			foreignColumns: [problems.id],
			name: "problem_versions_problem_id_fkey"
		}),
	unique("problem_version_identity").on(table.problem_id, table.id),
	unique("problem_versions_problem_version_key").on(table.problem_id, table.version),
	check("problem_versions_difficulty_check", sql`difficulty = ANY (ARRAY['easy'::text, 'medium'::text, 'hard'::text])`),
]);

export const interviews = pgTable("interviews", {
	id: uuid().primaryKey().notNull(),
	host_id: text().notNull(),
	title: text().notNull(),
	state: text().default('active').notNull(),
	question: jsonb().notNull(),
	language: text().notNull(),
	source: text().notNull(),
	document_version: bigint({ mode: "bigint" }).default(0n).notNull(),
	document_epoch: uuid().notNull(),
	version: bigint({ mode: "bigint" }).default(1n).notNull(),
	invite_hash: text().notNull(),
	invite_token: text().notNull(),
	guest_joins: integer().default(0).notNull(),
	created_at: timestamp({ withTimezone: true, mode: 'string' }).default(sql`clock_timestamp()`).notNull(),
	updated_at: timestamp({ withTimezone: true, mode: 'string' }).default(sql`clock_timestamp()`).notNull(),
	question_epoch: uuid().notNull(),
	interviewer_invite_token: text().notNull(),
	interviewer_invite_hash: text().notNull(),
	deleted_at: timestamp({ withTimezone: true, mode: 'string' }),
	monitoring: jsonb().default({}).notNull(),
	admission_locked: boolean().default(false).notNull(),
	lossless_question: bytea("lossless_question"),
}, (table): PgTableExtraConfigValue[] => [
	uniqueIndex("interview_interviewer_invite").using("btree", table.interviewer_invite_hash.asc().nullsLast().op("text_ops")),
	index("interviews_host_active").using("btree", table.host_id.asc().nullsLast().op("text_ops")).where(sql`(state = 'active'::text)`),
	foreignKey({
			columns: [table.host_id],
			foreignColumns: [users.id],
			name: "interviews_host_id_fkey"
		}),
	unique("interviews_invite_hash_key").on(table.invite_hash),
	check("interviews_deleted_closed", sql`(deleted_at IS NULL) OR (state = 'closed'::text)`),
	check("interviews_monitoring_check", sql`jsonb_typeof(monitoring) = 'object'::text`),
	check("interviews_state_check", sql`state = ANY (ARRAY['active'::text, 'closed'::text])`),
]);

export const submissions = pgTable("submissions", {
	id: uuid().primaryKey().notNull(),
	owner_id: text().notNull(),
	workspace_id: uuid(),
	kind: text().notNull(),
	source: text().notNull(),
	source_hash: text().notNull(),
	state: text().notNull(),
	cases: jsonb().notNull(),
	result: jsonb(),
	cancel_requested: boolean().default(false).notNull(),
	admitted_at: timestamp({ withTimezone: true, mode: 'string' }).default(sql`clock_timestamp()`).notNull(),
	updated_at: timestamp({ withTimezone: true, mode: 'string' }).default(sql`clock_timestamp()`).notNull(),
	match_id: uuid(),
	match_sequence: bigint({ mode: "bigint" }),
	odyssey_level: integer(),
	custom_run: boolean().default(false).notNull(),
	interview_id: uuid(),
	result_payload: bytea("result_payload"),
	lossless_cases: bytea("lossless_cases"),
}, (table): PgTableExtraConfigValue[] => [
	index("match_submission_history").using("btree", table.match_id.asc().nullsLast().op("timestamptz_ops"), table.admitted_at.asc().nullsLast().op("uuid_ops"), table.match_sequence.asc().nullsLast().op("uuid_ops")).where(sql`((match_id IS NOT NULL) AND (kind = 'submit'::text))`),
	uniqueIndex("match_submission_order").using("btree", table.match_id.asc().nullsLast().op("uuid_ops"), table.match_sequence.asc().nullsLast().op("int8_ops")).where(sql`(match_sequence IS NOT NULL)`),
	uniqueIndex("owner_busy").using("btree", table.owner_id.asc().nullsLast().op("text_ops")).where(sql`(state = ANY (ARRAY['queued'::text, 'running'::text]))`),
	index("submission_odyssey_history").using("btree", table.workspace_id.asc().nullsLast().op("uuid_ops"), table.admitted_at.desc().nullsFirst().op("timestamptz_ops"), table.id.desc().nullsFirst().op("uuid_ops")).where(sql`((state = 'completed'::text) AND (NOT custom_run) AND (odyssey_level IS NOT NULL))`),
	index("submission_quota").using("btree", table.owner_id.asc().nullsLast().op("text_ops"), table.admitted_at.desc().nullsFirst().op("timestamptz_ops")),
	index("submission_workspace_active").using("btree", table.workspace_id.asc().nullsLast().op("uuid_ops")).where(sql`((workspace_id IS NOT NULL) AND (state = ANY (ARRAY['queued'::text, 'running'::text])))`),
	index("submissions_interview").using("btree", table.interview_id.asc().nullsLast().op("uuid_ops")).where(sql`(interview_id IS NOT NULL)`),
	foreignKey({
			columns: [table.match_id],
			foreignColumns: [matches.id],
			name: "submissions_match_id_fkey"
		}),
	foreignKey({
			columns: [table.owner_id],
			foreignColumns: [users.id],
			name: "submissions_owner_id_fkey"
		}),
	foreignKey({
			columns: [table.interview_id],
			foreignColumns: [interviews.id],
			name: "submissions_interview_id_fkey"
		}),
	foreignKey({
			columns: [table.workspace_id, table.owner_id],
			foreignColumns: [workspaces.id, workspaces.owner_id],
			name: "submission_workspace_owner_fkey"
		}),
	foreignKey({
			columns: [table.id, table.interview_id],
			foreignColumns: [interview_execution.submission_id, interview_execution.session_id],
			name: "submission_interview_execution_fkey"
		}),
	unique("submission_interview_identity").on(table.id, table.interview_id),
	check("submissions_kind_check", sql`kind = ANY (ARRAY['run'::text, 'submit'::text])`),
	check("submissions_state_check", sql`state = ANY (ARRAY['queued'::text, 'running'::text, 'completed'::text, 'cancelled'::text, 'failed'::text])`),
	check("submission_context_check", sql`((workspace_id IS NULL) <> (interview_id IS NULL)) AND ((interview_id IS NULL) OR (match_id IS NULL))`),
]);

export const problem_companies = pgTable("problem_companies", {
	problem_id: uuid().notNull(),
	company_id: bigint({ mode: "bigint" }).notNull(),
}, (table): PgTableExtraConfigValue[] => [
	index("problem_companies_company_id").using("btree", table.company_id.asc().nullsLast().op("int8_ops"), table.problem_id.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.problem_id],
			foreignColumns: [problems.id],
			name: "problem_companies_problem_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.company_id],
			foreignColumns: [companies.id],
			name: "problem_companies_company_id_fkey"
		}).onDelete("cascade"),
	primaryKey({ columns: [table.problem_id, table.company_id], name: "problem_companies_pkey"}),
]);

export const guest_request_buckets = pgTable("guest_request_buckets", {
	key: text().notNull(),
	window_start: timestamp({ withTimezone: true, mode: 'string' }).notNull(),
	used: integer().notNull(),
}, (table): PgTableExtraConfigValue[] => [
	index("guest_request_buckets_window").using("btree", table.window_start.asc().nullsLast().op("timestamptz_ops")),
	primaryKey({ columns: [table.key, table.window_start], name: "guest_request_buckets_pkey"}),
]);

export const problem_tags = pgTable("problem_tags", {
	version_id: uuid().notNull(),
	tag: text().notNull(),
	ordinal: integer().notNull(),
}, (table): PgTableExtraConfigValue[] => [
	foreignKey({
			columns: [table.version_id],
			foreignColumns: [problem_versions.id],
			name: "problem_tags_version_id_fkey"
		}).onDelete("cascade"),
	primaryKey({ columns: [table.version_id, table.tag], name: "problem_tags_pkey"}),
	unique("problem_tags_version_id_ordinal_key").on(table.version_id, table.ordinal),
	check("problem_tags_ordinal_check", sql`ordinal >= 0`),
	check("problem_tags_tag_check", sql`length(tag) > 0`),
]);

export const interview_case_visibility = pgTable("interview_case_visibility", {
	session_id: uuid().notNull(),
	question_epoch: uuid().notNull(),
	case_id: text().notNull(),
}, (table): PgTableExtraConfigValue[] => [
	foreignKey({
			columns: [table.session_id],
			foreignColumns: [interviews.id],
			name: "interview_case_visibility_session_id_fkey"
		}).onDelete("cascade"),
	primaryKey({ columns: [table.session_id, table.question_epoch, table.case_id], name: "interview_case_visibility_pkey"}),
]);

export const identity_bindings = pgTable("identity_bindings", {
	issuer: text().notNull(),
	subject: text().notNull(),
	user_id: text().notNull(),
}, (table): PgTableExtraConfigValue[] => [
	foreignKey({
			columns: [table.user_id],
			foreignColumns: [users.id],
			name: "identity_bindings_user_id_fkey"
		}),
	primaryKey({ columns: [table.issuer, table.subject], name: "identity_bindings_pkey"}),
]);

export const execution_checkpoint_cases = pgTable("execution_checkpoint_cases", {
	job_id: uuid().notNull(),
	ordinal: integer().notNull(),
	frame: bytea("frame").notNull(),
}, (table): PgTableExtraConfigValue[] => [
	foreignKey({
			columns: [table.job_id],
			foreignColumns: [execution_checkpoints.job_id],
			name: "execution_checkpoint_cases_job_id_fkey"
		}).onDelete("cascade"),
	primaryKey({ columns: [table.job_id, table.ordinal], name: "execution_checkpoint_cases_pkey"}),
	check("execution_checkpoint_cases_ordinal_check", sql`(ordinal >= 0) AND (ordinal <= 319)`),
]);

export const interview_members = pgTable("interview_members", {
	session_id: uuid().notNull(),
	user_id: text().notNull(),
	role: text().notNull(),
	removed_at: timestamp({ withTimezone: true, mode: 'string' }),
}, (table): PgTableExtraConfigValue[] => [
	index("interview_members_user").using("btree", table.user_id.asc().nullsLast().op("text_ops")).where(sql`(removed_at IS NULL)`),
	foreignKey({
			columns: [table.session_id],
			foreignColumns: [interviews.id],
			name: "interview_members_session_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.user_id],
			foreignColumns: [users.id],
			name: "interview_members_user_id_fkey"
		}),
	primaryKey({ columns: [table.session_id, table.user_id], name: "interview_members_pkey"}),
	check("interview_members_role_check", sql`role = ANY (ARRAY['interviewer'::text, 'interviewee'::text])`),
]);

export const interview_language_drafts = pgTable("interview_language_drafts", {
	session_id: uuid().notNull(),
	question_epoch: uuid().notNull(),
	language: text().notNull(),
	source: text().notNull(),
}, (table): PgTableExtraConfigValue[] => [
	foreignKey({
			columns: [table.session_id],
			foreignColumns: [interviews.id],
			name: "interview_language_drafts_session_id_fkey"
		}).onDelete("cascade"),
	primaryKey({ columns: [table.session_id, table.question_epoch, table.language], name: "interview_language_drafts_pkey"}),
]);

export const problem_odyssey_cases = pgTable("problem_odyssey_cases", {
	version_id: uuid().notNull(),
	level: integer().notNull(),
	ordinal: integer().notNull(),
	case_data: jsonb().notNull(),
}, (table): PgTableExtraConfigValue[] => [
	foreignKey({
			columns: [table.version_id],
			foreignColumns: [problem_versions.id],
			name: "problem_odyssey_cases_version_id_fkey"
		}).onDelete("cascade"),
	primaryKey({ columns: [table.version_id, table.level, table.ordinal], name: "problem_odyssey_cases_pkey"}),
	check("problem_odyssey_cases_level_check", sql`level >= 0`),
	check("problem_odyssey_cases_ordinal_check", sql`ordinal >= 0`),
]);

export const interview_question_snapshots = pgTable("interview_question_snapshots", {
	session_id: uuid().notNull(),
	id: bytea("id").notNull(),
	fixture: jsonb().notNull(),
	lossless_fixture: bytea("lossless_fixture"),
}, (table): PgTableExtraConfigValue[] => [
	foreignKey({
			columns: [table.session_id],
			foreignColumns: [interviews.id],
			name: "interview_question_snapshots_session_id_fkey"
		}).onDelete("cascade"),
	primaryKey({ columns: [table.session_id, table.id], name: "interview_question_snapshots_pkey"}),
	check("interview_question_snapshots_check", sql`id = sha256(convert_to((fixture)::text, 'UTF8'::name))`),
	check("lossless_fixture_hash", sql`(lossless_fixture IS NULL) OR (NOT ((fixture ->> '_lossless_sha256'::text) IS DISTINCT FROM encode(sha256(lossless_fixture), 'hex'::text)))`),
]);

export const odyssey_progress = pgTable("odyssey_progress", {
	scope_id: uuid().notNull(),
	problem_version_id: uuid().notNull(),
	level: integer().default(1).notNull(),
	completed: boolean().default(false).notNull(),
	reset_at: timestamp({ withTimezone: true, mode: 'string' }).default(sql`'-infinity'`).notNull(),
}, (table): PgTableExtraConfigValue[] => [
	primaryKey({ columns: [table.scope_id, table.problem_version_id], name: "odyssey_progress_pkey"}),
	check("odyssey_progress_level_check", sql`(level >= 1) AND (level <= 8)`),
]);

export const cancellation_idempotency = pgTable("cancellation_idempotency", {
	owner_id: text().notNull(),
	key: text().notNull(),
	submission_id: uuid().notNull(),
	response: jsonb().notNull(),
	expires_at: timestamp({ withTimezone: true, mode: 'string' }).notNull(),
}, (table): PgTableExtraConfigValue[] => [
	index("cancellation_idempotency_expiry").using("btree", table.expires_at.asc().nullsLast().op("timestamptz_ops")),
	foreignKey({
			columns: [table.owner_id],
			foreignColumns: [users.id],
			name: "cancellation_idempotency_owner_id_fkey"
		}),
	foreignKey({
			columns: [table.submission_id],
			foreignColumns: [submissions.id],
			name: "cancellation_idempotency_submission_id_fkey"
		}),
	primaryKey({ columns: [table.owner_id, table.key], name: "cancellation_idempotency_pkey"}),
]);

export const execution_idempotency = pgTable("execution_idempotency", {
	owner_id: text().notNull(),
	key: text().notNull(),
	body_hash: text().notNull(),
	submission_id: uuid().notNull(),
	expires_at: timestamp({ withTimezone: true, mode: 'string' }).notNull(),
}, (table): PgTableExtraConfigValue[] => [
	index("execution_idempotency_expiry").using("btree", table.expires_at.asc().nullsLast().op("timestamptz_ops")),
	foreignKey({
			columns: [table.owner_id],
			foreignColumns: [users.id],
			name: "execution_idempotency_owner_id_fkey"
		}),
	foreignKey({
			columns: [table.submission_id],
			foreignColumns: [submissions.id],
			name: "execution_idempotency_submission_id_fkey"
		}),
	primaryKey({ columns: [table.owner_id, table.key], name: "execution_idempotency_pkey"}),
]);

export const interview_operations = pgTable("interview_operations", {
	owner_id: text().notNull(),
	key: text().notNull(),
	fingerprint: text().notNull(),
	session_id: uuid().notNull(),
	response: jsonb(),
}, (table): PgTableExtraConfigValue[] => [
	foreignKey({
			columns: [table.owner_id],
			foreignColumns: [users.id],
			name: "interview_operations_owner_id_fkey"
		}),
	foreignKey({
			columns: [table.session_id],
			foreignColumns: [interviews.id],
			name: "interview_operations_session_id_fkey"
		}).onDelete("cascade"),
	primaryKey({ columns: [table.owner_id, table.key], name: "interview_operations_pkey"}),
]);

export const interview_updates = pgTable("interview_updates", {
	session_id: uuid().notNull(),
	epoch: uuid().notNull(),
	version: bigint({ mode: "bigint" }).notNull(),
	client_id: text().notNull(),
	changes: jsonb().notNull(),
}, (table): PgTableExtraConfigValue[] => [
	foreignKey({
			columns: [table.session_id],
			foreignColumns: [interviews.id],
			name: "interview_updates_session_id_fkey"
		}).onDelete("cascade"),
	primaryKey({ columns: [table.session_id, table.epoch, table.version], name: "interview_updates_pkey"}),
]);

export const problem_test_cases = pgTable("problem_test_cases", {
	version_id: uuid().notNull(),
	ordinal: integer().notNull(),
	args: jsonb().notNull(),
	expected: jsonb().notNull(),
	calls: jsonb().default([]).notNull(),
}, (table): PgTableExtraConfigValue[] => [
	foreignKey({
			columns: [table.version_id],
			foreignColumns: [problem_versions.id],
			name: "problem_test_cases_version_id_fkey"
		}).onDelete("cascade"),
	primaryKey({ columns: [table.version_id, table.ordinal], name: "problem_test_cases_pkey"}),
	check("problem_test_cases_ordinal_check", sql`ordinal >= 0`),
]);

export const match_idempotency = pgTable("match_idempotency", {
	owner_id: text().notNull(),
	route: text().notNull(),
	key: text().notNull(),
	body_hash: text().notNull(),
	response: jsonb().notNull(),
	expires_at: timestamp({ withTimezone: true, mode: 'string' }).notNull(),
}, (table): PgTableExtraConfigValue[] => [
	index("match_idempotency_expiry").using("btree", table.expires_at.asc().nullsLast().op("timestamptz_ops")),
	foreignKey({
			columns: [table.owner_id],
			foreignColumns: [users.id],
			name: "match_idempotency_owner_id_fkey"
		}),
	primaryKey({ columns: [table.owner_id, table.route, table.key], name: "match_idempotency_pkey"}),
]);

export const problem_languages = pgTable("problem_languages", {
	version_id: uuid().notNull(),
	language: text().notNull(),
	starter_source: text().notNull(),
	runtime_revision: text().notNull(),
	harness_revision: text().notNull(),
	reference_source: text().notNull(),
}, (table): PgTableExtraConfigValue[] => [
	foreignKey({
			columns: [table.version_id],
			foreignColumns: [problem_versions.id],
			name: "problem_languages_version_id_fkey"
		}).onDelete("cascade"),
	primaryKey({ columns: [table.version_id, table.language], name: "problem_languages_pkey"}),
	check("problem_languages_language_check", sql`language = ANY (ARRAY['python'::text, 'java'::text, 'typescript'::text, 'ocaml'::text, 'postgresql'::text])`),
]);

export const problem_examples = pgTable("problem_examples", {
	version_id: uuid().notNull(),
	ordinal: integer().notNull(),
	args: jsonb().notNull(),
	expected: jsonb().notNull(),
	explanation: text().default('').notNull(),
	calls: jsonb().default([]).notNull(),
}, (table): PgTableExtraConfigValue[] => [
	foreignKey({
			columns: [table.version_id],
			foreignColumns: [problem_versions.id],
			name: "problem_examples_version_id_fkey"
		}).onDelete("cascade"),
	primaryKey({ columns: [table.version_id, table.ordinal], name: "problem_examples_pkey"}),
	check("problem_examples_ordinal_check", sql`ordinal >= 0`),
]);

export const quota_overrides = pgTable("quota_overrides", {
	user_id: text().notNull(),
	resource: text().notNull(),
	value: integer().notNull(),
	expires_at: timestamp({ withTimezone: true, mode: 'string' }),
	actor: text().notNull(),
	reason: text().notNull(),
}, (table): PgTableExtraConfigValue[] => [
	foreignKey({
			columns: [table.user_id],
			foreignColumns: [users.id],
			name: "quota_overrides_user_id_fkey"
		}),
	primaryKey({ columns: [table.user_id, table.resource], name: "quota_overrides_pkey"}),
	check("quota_overrides_value_check", sql`(value > 0) AND (value <= 600000)`),
	check("quota_overrides_resource_check", sql`resource = ANY (ARRAY['guest_concurrency'::text, 'interview_concurrency'::text])`),
]);

export const problem_solutions = pgTable("problem_solutions", {
	version_id: uuid().notNull(),
	language: text().notNull(),
	source: text().notNull(),
	explanation_markdown: text().notNull(),
	time_complexity: text().notNull(),
	space_complexity: text().notNull(),
	complexity_notes: text().notNull(),
}, (table): PgTableExtraConfigValue[] => [
	foreignKey({
			columns: [table.version_id, table.language],
			foreignColumns: [problem_languages.version_id, problem_languages.language],
			name: "problem_solutions_version_id_language_fkey"
		}).onDelete("cascade"),
	primaryKey({ columns: [table.version_id, table.language], name: "problem_solutions_pkey"}),
]);

export const interview_presence = pgTable("interview_presence", {
	session_id: uuid().notNull(),
	user_id: text().notNull(),
	client_id: text().notNull(),
	epoch: uuid().notNull(),
	version: bigint({ mode: "bigint" }).notNull(),
	anchor: integer().notNull(),
	head: integer().notNull(),
	updated_at: timestamp({ withTimezone: true, mode: 'string' }).default(sql`clock_timestamp()`).notNull(),
}, (table): PgTableExtraConfigValue[] => [
	foreignKey({
			columns: [table.session_id],
			foreignColumns: [interviews.id],
			name: "interview_presence_session_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.user_id],
			foreignColumns: [users.id],
			name: "interview_presence_user_id_fkey"
		}),
	primaryKey({ columns: [table.session_id, table.user_id, table.client_id], name: "interview_presence_pkey"}),
]);

export const match_participants = pgTable("match_participants", {
	match_id: uuid().notNull(),
	owner_id: text().notNull(),
	seat: integer().notNull(),
	ready: boolean().default(false).notNull(),
	presence: text().default('offline').notNull(),
	workspace_id: uuid(),
	best_passed: integer().default(0).notNull(),
	submission_state: text(),
	forfeited: boolean().default(false).notNull(),
	last_rule_event_at: timestamp({ withTimezone: true, mode: 'string' }),
}, (table): PgTableExtraConfigValue[] => [
	foreignKey({
			columns: [table.match_id],
			foreignColumns: [matches.id],
			name: "match_participants_match_id_fkey"
		}),
	foreignKey({
			columns: [table.owner_id],
			foreignColumns: [users.id],
			name: "match_participants_owner_id_fkey"
		}),
	foreignKey({
			columns: [table.workspace_id, table.owner_id],
			foreignColumns: [workspaces.id, workspaces.owner_id],
			name: "match_participant_workspace_owner_fkey"
		}),
	primaryKey({ columns: [table.match_id, table.owner_id], name: "match_participants_pkey"}),
	unique("match_participants_match_id_seat_key").on(table.match_id, table.seat),
	check("match_participants_presence_check", sql`presence = ANY (ARRAY['online'::text, 'offline'::text])`),
	check("match_participants_seat_check", sql`(seat >= 1) AND (seat <= 8)`),
]);
