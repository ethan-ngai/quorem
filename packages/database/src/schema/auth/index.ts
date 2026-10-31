import { pgTable, pgSchema, text, timestamp, index, integer, unique, boolean, foreignKey, bigint, uniqueIndex, check } from "drizzle-orm/pg-core"
import { sql } from "drizzle-orm"

export const quorem_auth = pgSchema("quorem_auth");


export const schema_migrationsInQuorem_auth = quorem_auth.table("schema_migrations", {
	name: text().primaryKey().notNull(),
});

export const jwksInQuorem_auth = quorem_auth.table("jwks", {
	id: text().primaryKey().notNull(),
	publicKey: text().notNull(),
	privateKey: text().notNull(),
	createdAt: timestamp({ withTimezone: true, mode: 'date' }).notNull(),
	expiresAt: timestamp({ withTimezone: true, mode: 'date' }),
	alg: text(),
	crv: text(),
});

export const rate_limitInQuorem_auth = quorem_auth.table("rate_limit", {
	bucket: text().primaryKey().notNull(),
	used: integer().notNull(),
	expires_at: timestamp({ withTimezone: true, mode: 'date' }).notNull(),
}, (table) => [
	index("rate_limit_expiry").using("btree", table.expires_at.asc().nullsLast().op("timestamptz_ops")),
]);

export const registration_emailInQuorem_auth = quorem_auth.table("registration_email", {
	email: text().primaryKey().notNull(),
	token_hash: text(),
	grant_hash: text(),
	expires_at: timestamp({ withTimezone: true, mode: 'date' }).notNull(),
	last_sent_at: timestamp({ withTimezone: true, mode: 'date' }).notNull(),
}, (table) => [
	index("registration_email_expiry").using("btree", table.expires_at.asc().nullsLast().op("timestamptz_ops")),
	unique("registration_email_token_hash_key").on(table.token_hash),
	unique("registration_email_grant_hash_key").on(table.grant_hash),
]);

export const social_emailInQuorem_auth = quorem_auth.table("social_email", {
	proof_hash: text().primaryKey().notNull(),
	provider: text().notNull(),
	account_id: text().notNull(),
	email: text(),
	token_hash: text(),
	linking: boolean().default(false).notNull(),
	verified: boolean().default(false).notNull(),
	expires_at: timestamp({ withTimezone: true, mode: 'date' }).notNull(),
}, (table) => [
	index("social_email_expiry").using("btree", table.expires_at.asc().nullsLast().op("timestamptz_ops")),
	index("social_email_identity").using("btree", table.provider.asc().nullsLast().op("text_ops"), table.account_id.asc().nullsLast().op("text_ops")),
	unique("social_email_token_hash_key").on(table.token_hash),
]);

export const verificationInQuorem_auth = quorem_auth.table("verification", {
	id: text().primaryKey().notNull(),
	identifier: text().notNull(),
	value: text().notNull(),
	expiresAt: timestamp({ withTimezone: true, mode: 'date' }).notNull(),
	createdAt: timestamp({ withTimezone: true, mode: 'date' }),
	updatedAt: timestamp({ withTimezone: true, mode: 'date' }),
}, (table) => [
	index("auth_verification_identifier").using("btree", table.identifier.asc().nullsLast().op("text_ops")),
]);

export const accountInQuorem_auth = quorem_auth.table("account", {
	id: text().primaryKey().notNull(),
	accountId: text().notNull(),
	providerId: text().notNull(),
	userId: text().notNull(),
	accessToken: text(),
	refreshToken: text(),
	idToken: text(),
	accessTokenExpiresAt: timestamp({ withTimezone: true, mode: 'date' }),
	refreshTokenExpiresAt: timestamp({ withTimezone: true, mode: 'date' }),
	scope: text(),
	password: text(),
	createdAt: timestamp({ withTimezone: true, mode: 'date' }).notNull(),
	updatedAt: timestamp({ withTimezone: true, mode: 'date' }).notNull(),
}, (table) => [
	index("auth_account_user").using("btree", table.userId.asc().nullsLast().op("text_ops")),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [userInQuorem_auth.id],
			name: "account_userId_fkey"
		}).onDelete("cascade"),
	unique("account_providerId_accountId_key").on(table.providerId, table.accountId),
]);

export const passkeyInQuorem_auth = quorem_auth.table("passkey", {
	id: text().primaryKey().notNull(),
	name: text(),
	publicKey: text().notNull(),
	userId: text().notNull(),
	credentialID: text().notNull(),
	counter: bigint({ mode: "bigint" }).notNull(),
	deviceType: text().notNull(),
	backedUp: boolean().notNull(),
	transports: text(),
	createdAt: timestamp({ withTimezone: true, mode: 'date' }),
	aaguid: text(),
}, (table) => [
	index("auth_passkey_user").using("btree", table.userId.asc().nullsLast().op("text_ops")),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [userInQuorem_auth.id],
			name: "passkey_userId_fkey"
		}).onDelete("cascade"),
	unique("passkey_credentialID_key").on(table.credentialID),
]);

export const sessionInQuorem_auth = quorem_auth.table("session", {
	id: text().primaryKey().notNull(),
	expiresAt: timestamp({ withTimezone: true, mode: 'date' }).notNull(),
	token: text().notNull(),
	createdAt: timestamp({ withTimezone: true, mode: 'date' }).notNull(),
	updatedAt: timestamp({ withTimezone: true, mode: 'date' }).notNull(),
	ipAddress: text(),
	userAgent: text(),
	userId: text().notNull(),
}, (table) => [
	index("auth_session_user").using("btree", table.userId.asc().nullsLast().op("text_ops")),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [userInQuorem_auth.id],
			name: "session_userId_fkey"
		}).onDelete("cascade"),
	unique("session_token_key").on(table.token),
]);

export const session_assuranceInQuorem_auth = quorem_auth.table("session_assurance", {
	session_id: text().primaryKey().notNull(),
	strong_at: timestamp({ withTimezone: true, mode: 'date' }).default(sql`clock_timestamp()`).notNull(),
}, (table) => [
	foreignKey({
			columns: [table.session_id],
			foreignColumns: [sessionInQuorem_auth.id],
			name: "session_assurance_session_id_fkey"
		}).onDelete("cascade"),
]);

export const userInQuorem_auth = quorem_auth.table("user", {
	id: text().primaryKey().notNull(),
	name: text().notNull(),
	email: text().notNull(),
	emailVerified: boolean().default(false).notNull(),
	image: text(),
	createdAt: timestamp({ withTimezone: true, mode: 'date' }).notNull(),
	updatedAt: timestamp({ withTimezone: true, mode: 'date' }).notNull(),
	username: text(),
	displayUsername: text(),
	profile_color: integer().default(sql`((floor((random() * (24)::double precision)))::integer + 1)`).notNull(),
	profile_color_revision: bigint({ mode: "bigint" }).default(sql`(floor((EXTRACT(epoch FROM clock_timestamp()) * (1000)::numeric)))::bigint`).notNull(),
}, (table) => [
	uniqueIndex("auth_username_unique").using("btree", table.username.asc().nullsLast().op("text_ops")).where(sql`(username IS NOT NULL)`),
	unique("user_email_key").on(table.email),
	check("user_profile_color_check", sql`(profile_color >= 1) AND (profile_color <= 24)`),
]);
