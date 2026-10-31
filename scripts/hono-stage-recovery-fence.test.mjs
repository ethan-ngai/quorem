import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { randomBytes } from "node:crypto";
import { fenceStageRuntime } from "./hono-stage-recovery-fence.mjs";
const { Client } = createRequire(new URL("../packages/database/package.json", import.meta.url))(
  "pg",
);
const url = process.env.QUOREM_STAGE_RECOVERY_TEST_DATABASE_URL;
if (url) {
  const parsed = new URL(url);
  if (
    !["127.0.0.1", "localhost", "[::1]"].includes(parsed.hostname) ||
    parsed.port !== "55598" ||
    parsed.pathname !== "/quorem_hono_stage" ||
    [...parsed.searchParams.keys()].some((key) =>
      ["host", "hostaddr", "service"].includes(key.toLowerCase()),
    )
  )
    throw new Error("Isolated stage recovery database required");
}
const connect = async (connectionString) => {
  const client = new Client({ connectionString, connectionTimeoutMillis: 3000 });
  client.on("error", () => {});
  await client.connect();
  return client;
};
void test(
  "fences active and future stage runtime sessions without discarding data",
  { skip: !url },
  async () => {
    const admin = await connect(url),
      role = `quorem_stage_runtime_${randomBytes(8).toString("hex")}`,
      password = randomBytes(24).toString("hex"),
      group = `quorem_stage_group_${randomBytes(8).toString("hex")}`,
      nested = `quorem_stage_nested_${randomBytes(8).toString("hex")}`;
    let runtime;
    try {
      await admin.query(`CREATE ROLE "${role}" LOGIN PASSWORD '${password}'`);
      await admin.query(`CREATE ROLE "${group}" NOLOGIN`);
      await admin.query(`CREATE ROLE "${nested}" NOLOGIN`);
      await admin.query(`GRANT "${role}" TO "${group}"`);
      await admin.query(`GRANT "${group}" TO "${nested}"`);
      await assert.rejects(fenceStageRuntime(admin, role), /preconditions/);
      assert.equal(
        (await admin.query("SELECT rolcanlogin FROM pg_roles WHERE rolname=$1", [role])).rows[0]
          .rolcanlogin,
        true,
      );
      await admin.query(`REVOKE "${group}" FROM "${nested}"`);
      await admin.query(`REVOKE "${role}" FROM "${group}"`);
      const runtimeUrl = new URL(url);
      runtimeUrl.username = role;
      runtimeUrl.password = password;
      runtime = await connect(runtimeUrl.href);
      const dead = new Promise((resolve) => runtime.once("end", resolve));
      assert.deepEqual(await fenceStageRuntime(admin, role), { role, disabled: true });
      await dead;
      await assert.rejects(connect(runtimeUrl.href));
      assert.equal(
        (await admin.query("SELECT rolcanlogin FROM pg_roles WHERE rolname=$1", [role])).rows[0]
          .rolcanlogin,
        false,
      );
      assert.deepEqual(await fenceStageRuntime(admin, role), { role, disabled: true });
    } finally {
      await runtime?.end().catch(() => {});
      await admin.query(`DROP ROLE IF EXISTS "${nested}"`);
      await admin.query(`DROP ROLE IF EXISTS "${group}"`);
      await admin.query(`DROP ROLE IF EXISTS "${role}"`);
      await admin.end();
    }
  },
);
void test("a partial failure never restores revoked LOGIN", { skip: !url }, async () => {
  const admin = await connect(url),
    role = `quorem_stage_runtime_${randomBytes(8).toString("hex")}`;
  try {
    await admin.query(`CREATE ROLE "${role}" LOGIN`);
    const failing = {
      query(sql, params) {
        if (sql.includes("pg_terminate_backend"))
          throw new Error("fixture termination uncertainty");
        return admin.query(sql, params);
      },
    };
    await assert.rejects(fenceStageRuntime(failing, role));
    assert.equal(
      (await admin.query("SELECT rolcanlogin FROM pg_roles WHERE rolname=$1", [role])).rows[0]
        .rolcanlogin,
      false,
    );
  } finally {
    await admin.query(`DROP ROLE IF EXISTS "${role}"`);
    await admin.end();
  }
});
void test("rejects identifiers outside the staged role namespace", async () => {
  await assert.rejects(
    fenceStageRuntime(
      {
        query() {
          throw new Error("must not query");
        },
      },
      "postgres",
    ),
    /Invalid/,
  );
});

void test(
  "delegated role operator with explicit admin and signaling can fence without superuser",
  { skip: !url },
  async () => {
    let admin = await connect(url);
    const suffix = randomBytes(8).toString("hex"),
      role = `quorem_stage_runtime_${suffix}`,
      operator = `quorem_stage_operator_${suffix}`,
      password = randomBytes(24).toString("hex");
    let delegated, runtime;
    try {
      await admin.query(`CREATE ROLE "${role}" LOGIN PASSWORD '${password}'`);
      await admin.query(`CREATE ROLE "${operator}" LOGIN CREATEROLE PASSWORD '${password}'`);
      await admin.query(`GRANT "${role}" TO "${operator}" WITH ADMIN OPTION`);
      await admin.query(`GRANT pg_signal_backend, pg_read_all_stats TO "${operator}"`);
      await admin.end();
      admin = undefined;
      const operatorUrl = new URL(url);
      operatorUrl.username = operator;
      operatorUrl.password = password;
      const runtimeUrl = new URL(url);
      runtimeUrl.username = role;
      runtimeUrl.password = password;
      delegated = await connect(operatorUrl.href);
      runtime = await connect(runtimeUrl.href);
      const dead = new Promise((resolve) => runtime.once("end", resolve));
      assert.deepEqual(
        await fenceStageRuntime(delegated, role, { trustedAdministrators: ["fixture"] }),
        { role, disabled: true },
      );
      await dead;
      await assert.rejects(connect(runtimeUrl.href));
    } finally {
      await runtime?.end().catch(() => {});
      await delegated?.end().catch(() => {});
      admin ??= await connect(url);
      await admin.query(`DROP ROLE IF EXISTS "${operator}"`);
      await admin.query(`DROP ROLE IF EXISTS "${role}"`);
      await admin.end();
    }
  },
);

void test(
  "prepared work blocks fencing without rollback or data loss",
  { skip: !url },
  async () => {
    const admin = await connect(url),
      suffix = randomBytes(8).toString("hex"),
      role = `quorem_stage_runtime_${suffix}`,
      table = `fence_fixture_${suffix}`,
      gid = `quorem_fence_${suffix}`;
    let prepared = false;
    try {
      await admin.query(`CREATE ROLE "${role}" LOGIN`);
      await admin.query(`CREATE TABLE "${table}" (id integer)`);
      await admin.query("BEGIN");
      await admin.query(`INSERT INTO "${table}" VALUES (42)`);
      await admin.query(`PREPARE TRANSACTION '${gid}'`);
      prepared = true;
      await assert.rejects(fenceStageRuntime(admin, role), /preconditions/);
      assert.equal(
        (await admin.query("SELECT rolcanlogin FROM pg_roles WHERE rolname=$1", [role])).rows[0]
          .rolcanlogin,
        true,
      );
      assert.equal(
        (await admin.query("SELECT count(*)::int AS n FROM pg_prepared_xacts WHERE gid=$1", [gid]))
          .rows[0].n,
        1,
      );
    } finally {
      if (prepared) await admin.query(`ROLLBACK PREPARED '${gid}'`);
      await admin.query(`DROP TABLE IF EXISTS "${table}"`);
      await admin.query(`DROP ROLE IF EXISTS "${role}"`);
      await admin.end();
    }
  },
);

void test(
  "terminates an already-switched session after its membership is revoked",
  { skip: !url },
  async () => {
    const admin = await connect(url),
      suffix = randomBytes(8).toString("hex"),
      role = `quorem_stage_runtime_${suffix}`,
      member = `quorem_stage_member_${suffix}`,
      password = randomBytes(24).toString("hex");
    let switched;
    try {
      await admin.query(`CREATE ROLE "${role}" LOGIN`);
      await admin.query(`CREATE ROLE "${member}" LOGIN PASSWORD '${password}'`);
      await admin.query(`GRANT "${role}" TO "${member}"`);
      await admin.query("REVOKE CONNECT ON DATABASE quorem_hono_stage FROM PUBLIC");
      await admin.query(`GRANT CONNECT ON DATABASE quorem_hono_stage TO "${member}"`);
      const memberUrl = new URL(url);
      memberUrl.username = member;
      memberUrl.password = password;
      switched = await connect(memberUrl.href);
      await switched.query(`SET ROLE "${role}"`);
      await admin.query(`REVOKE "${role}" FROM "${member}"`);
      await admin.query(`REVOKE CONNECT ON DATABASE quorem_hono_stage FROM "${member}"`);
      assert.equal((await switched.query("SELECT current_user AS name")).rows[0].name, role);
      const dead = new Promise((resolve) => switched.once("end", resolve));
      await fenceStageRuntime(admin, role);
      await dead;
    } finally {
      await switched?.end().catch(() => {});
      await admin.query("GRANT CONNECT ON DATABASE quorem_hono_stage TO PUBLIC");
      await admin.query(`DROP ROLE IF EXISTS "${member}"`);
      await admin.query(`DROP ROLE IF EXISTS "${role}"`);
      await admin.end();
    }
  },
);

void test("other logins with PUBLIC CONNECT block revocation", { skip: !url }, async () => {
  const admin = await connect(url),
    suffix = randomBytes(8).toString("hex"),
    role = `quorem_stage_runtime_${suffix}`,
    other = `quorem_stage_other_${suffix}`;
  try {
    await admin.query(`CREATE ROLE "${role}" LOGIN`);
    await admin.query(`CREATE ROLE "${other}" LOGIN`);
    await assert.rejects(fenceStageRuntime(admin, role), /other database logins/i);
    assert.equal(
      (await admin.query("SELECT rolcanlogin FROM pg_roles WHERE rolname=$1", [role])).rows[0]
        .rolcanlogin,
      true,
    );
  } finally {
    await admin.query(`DROP ROLE IF EXISTS "${other}"`);
    await admin.query(`DROP ROLE IF EXISTS "${role}"`);
    await admin.end();
  }
});
