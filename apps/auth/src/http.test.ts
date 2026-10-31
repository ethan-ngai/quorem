import { describe, expect, it } from "vitest";
import { createAuthApp } from "./http.ts";
import type { configuration } from "./config.ts";

const config = { method: "password", origin: "https://auth.test", passkey: true, registration: false, social: {} } as ReturnType<typeof configuration>;
describe("native auth mount", () => {
  it("preserves response cookies and keeps session authority private", async () => {
    const app = createAuthApp({ config, auth: { async handler() {
      const headers = new Headers();
      headers.append("Set-Cookie", "first=one; Path=/; HttpOnly");
      headers.append("Set-Cookie", "second=two; Path=/; HttpOnly");
      return new Response("ok", { headers });
    } } });
    const result=await app.request("https://auth.test/api/auth/get-session");
    expect(result.headers.getSetCookie()).toEqual(["first=one; Path=/; HttpOnly", "second=two; Path=/; HttpOnly"]);
    expect((await app.request("https://auth.test/internal/session/example")).status).toBe(404);
    expect((await app.request("https://auth.test/api/auth/registration/start",{method:"POST"})).status).toBe(404);
  });
});

describe.skipIf(!process.env.AUTH_TEST_DATABASE_URL)("native auth mount with PostgreSQL", () => {
  it("serves real Better Auth sessions and preserves cookies", async () => {
    Object.assign(process.env, {
      APP_ENV: "local", AUTH_MODE: "password", AUTH_ORIGIN: "http://localhost:5189",
      BETTER_AUTH_SECRET: "mock-secret-".repeat(4), AUTH_DATABASE_URL: process.env.AUTH_TEST_DATABASE_URL,
      AUTH_INTERNAL_SECRET: "fixture-secret",
    });
    const { auth, config, database, createAuth } = await (await import("./node-auth.ts")).createNodeRuntime(process.env);
    const { migrateAuth } = await import("./migrations.ts");
    await migrateAuth(database);
    const name = crypto.randomUUID();
    try {
      const signup = await createAuth(true).handler(new Request(`${config.origin}/api/auth/sign-up/email`, {
        method: "POST", headers: { Origin: config.origin, "Content-Type": "application/json" },
        body: JSON.stringify({ name, email: `${name}@example.test`, username: name.replaceAll("-", "").slice(0, 16), password: "fixture password" }),
      }));
      expect(signup.status).toBe(200);
      await database.query('UPDATE "user" SET "emailVerified"=true WHERE name=$1', [name]);
      const app=createAuthApp({config,auth});
      const response=await app.request(`${config.origin}/api/auth/sign-in/email`, {
        method: "POST", headers: { Origin: config.origin, "Content-Type": "application/json" },
        body: JSON.stringify({ email: `${name}@example.test`, password: "fixture password" }),
      });
      expect(response.status).toBe(200);
      const cookies=response.headers.getSetCookie();
      expect(cookies.length).toBeGreaterThan(0);
      const cookie=cookies.map(value=>value.split(";")[0]).join("; ");
      const session=await app.request(`${config.origin}/api/auth/get-session`, { headers: { cookie } });
      expect((await session.json()).user.email).toBe(`${name}@example.test`);
      expect((await app.request(`${config.origin}/internal/session/example`)).status).toBe(404);
    } finally {
      await database.query('DELETE FROM "user" WHERE name=$1', [name]);
      await database.end();
    }
  });
});
