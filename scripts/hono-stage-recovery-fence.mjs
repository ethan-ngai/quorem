/** Stage-only PostgreSQL writer fence. The caller must first prove admission and runner quiescence. */
const rolePattern = /^quorem_stage_runtime_[a-f0-9]{12,32}$/;
export const stageRecoveryLockKey = "quorem-stage-recovery-role-fence-v1";

async function inspect(client, role) {
  const result = await client.query(
    `WITH RECURSIVE inbound(oid) AS (
      SELECT m.member FROM pg_auth_members m JOIN pg_roles r ON r.oid=m.roleid WHERE r.rolname=$1
      UNION SELECT m.member FROM pg_auth_members m JOIN inbound i ON m.roleid=i.oid
    )
    SELECT current_database() AS database, current_user AS operator, session_user AS session_operator,
      r.rolname AS runtime, r.rolcanlogin AS login, r.rolsuper AS superuser,
      r.rolreplication AS replication, r.rolbypassrls AS bypassrls,
      r.rolcreaterole AS createrole, r.rolcreatedb AS createdb,
      EXISTS(SELECT 1 FROM inbound i JOIN pg_roles member_role ON member_role.oid=i.oid WHERE member_role.rolname<>current_user) AS has_members,
      o.rolsuper AS operator_superuser, o.rolcreaterole AS operator_createrole,
      pg_has_role(current_user, r.oid, 'MEMBER WITH ADMIN OPTION') AS role_admin,
      pg_has_role(current_user, 'pg_signal_backend', 'USAGE') AS can_signal,
      pg_has_role(current_user, 'pg_read_all_stats', 'USAGE') AS can_read_stats,
      (SELECT count(*)::int FROM pg_prepared_xacts WHERE database=current_database()) AS prepared
    FROM pg_roles r JOIN pg_roles o ON o.rolname=current_user WHERE r.rolname=$1`,
    [role],
  );
  if (result.rows.length !== 1) throw new Error("Stage runtime role unavailable");
  return result.rows[0];
}
function assertSafe(state, role) {
  if (
    state.database !== "quorem_hono_stage" ||
    state.operator !== state.session_operator ||
    state.operator === role ||
    state.runtime !== role ||
    state.superuser ||
    state.replication ||
    state.bypassrls ||
    state.createrole ||
    state.createdb ||
    state.has_members ||
    state.prepared !== 0 ||
    !state.can_signal ||
    !state.can_read_stats ||
    !(state.operator_superuser || (state.operator_createrole && state.role_admin))
  )
    throw new Error("Stage writer fence preconditions unavailable");
}
async function assertNoOtherLogins(client, role, trustedAdministrators) {
  const result = await client.query(
    `SELECT r.rolname, r.rolsuper FROM pg_roles r WHERE r.rolcanlogin AND r.rolname<>$1 AND r.rolname<>current_user AND has_database_privilege(r.oid,current_database(),'CONNECT')`,
    [role],
  );
  if (
    result.rows.some((row) => row.rolsuper !== true || !trustedAdministrators.includes(row.rolname))
  )
    throw new Error("Other database logins retain CONNECT");
}
function validateFenceInputs(role, trustedAdministrators) {
  if (!rolePattern.test(role ?? "")) throw new Error("Invalid staged runtime role");
  if (
    !Array.isArray(trustedAdministrators) ||
    trustedAdministrators.some(
      (name) => typeof name !== "string" || !/^[a-z_][a-z0-9_]{0,62}$/.test(name),
    ) ||
    new Set(trustedAdministrators).size !== trustedAdministrators.length
  )
    throw new Error("Invalid trusted administrators");
}
/** Verify the same role, ownership and session boundary without changing it. */
export async function assertStageRuntimeFenced(client, role, { trustedAdministrators = [] } = {}) {
  validateFenceInputs(role, trustedAdministrators);
  const state = await inspect(client, role);
  assertSafe(state, role);
  await assertNoOtherLogins(client, role, trustedAdministrators);
  if (state.login) throw new Error("Runtime login remains enabled");
  const remaining = await client.query(
    `SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname=current_database() AND backend_type='client backend' AND pid<>pg_backend_pid()`,
  );
  if (remaining.rows[0]?.n !== 0) throw new Error("Stage sessions remain");
}
/** Revocation is deliberately not undone on failure; no prepared transaction is discarded. */
export async function fenceStageRuntime(client, role, { trustedAdministrators = [] } = {}) {
  validateFenceInputs(role, trustedAdministrators);
  const lock = await client.query(
    "SELECT pg_try_advisory_lock(hashtextextended($1,0)) AS acquired",
    [stageRecoveryLockKey],
  );
  if (lock.rows[0]?.acquired !== true) throw new Error("Stage recovery is already running");
  try {
    assertSafe(await inspect(client, role), role);
    await assertNoOtherLogins(client, role, trustedAdministrators);
    await client.query("BEGIN");
    try {
      await client.query("SET LOCAL lock_timeout = '5s'");
      await client.query(`ALTER ROLE "${role}" NOLOGIN`);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
    await client.query("BEGIN");
    try {
      await client.query("SET LOCAL statement_timeout = '30s'");
      const terminated = await client.query(
        `SELECT pg_terminate_backend(pid,5000) AS stopped FROM pg_stat_activity WHERE datname=current_database() AND backend_type='client backend' AND pid<>pg_backend_pid()`,
      );
      if (terminated.rows.some((row) => row.stopped !== true))
        throw new Error("Stage sessions did not terminate");
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
    await assertStageRuntimeFenced(client, role, { trustedAdministrators });
    return { role, disabled: true };
  } finally {
    await client.query("SELECT pg_advisory_unlock(hashtextextended($1,0))", [stageRecoveryLockKey]);
  }
}
