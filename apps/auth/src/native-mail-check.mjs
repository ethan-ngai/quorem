import assert from "node:assert/strict";
import { Pool } from "pg";
const origin = "http://localhost:58738";
const pool = new Pool({
  connectionString: "postgres://postgres:fixture-only@127.0.0.1:55438/quorem_hono_auth_native_test",
});
const id = crypto.randomUUID(),
  email = `mail-${id}@example.test`,
  username = `u${id.replaceAll("-", "").slice(0, 14)}`;
const post = (path, body, cookie = "") =>
  fetch(origin + path, {
    method: "POST",
    headers: { origin, cookie, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
try {
  await pool.query("DELETE FROM quorem_auth.rate_limit");
  const begin = await post("/api/auth/registration/start", { email });
  assert.equal(begin.status, 200, await begin.clone().text());
  const messages = await (
    await fetch(origin + `/fixture/mail?email=${encodeURIComponent(email)}`)
  ).json();
  assert.equal(messages.length, 1);
  assert.equal(messages[0].transactions, 0);
  const token = new URL(messages[0].url).searchParams.get("signupToken");
  assert(token);
  const stored = (
    await pool.query(
      "SELECT state,ciphertext FROM quorem_auth.mail_intent WHERE purpose='registration' ORDER BY created_at DESC LIMIT 1",
    )
  ).rows[0];
  assert.equal(stored.state, "accepted");
  assert.equal(stored.ciphertext.includes(Buffer.from(token)), false);
  assert.equal(stored.ciphertext.includes(Buffer.from(email)), false);
  const verified = await post("/api/auth/registration/verify", { token });
  assert.equal(verified.status, 200, await verified.clone().text());
  const cookie = verified.headers
    .getSetCookie()
    .map((value) => value.split(";")[0])
    .join("; ");
  const repeat = await post("/api/auth/registration/verify", { token });
  assert.equal(repeat.status, 400);
  const complete = await post(
    "/api/auth/registration/complete",
    { email, username, name: "Fixture", password: "Fixture123!" },
    cookie,
  );
  assert.equal(complete.status, 200, await complete.clone().text());
  const login = await post("/api/auth/sign-in/email", { email, password: "Fixture123!" });
  assert.equal(login.status, 200, await login.clone().text());
  const reset = await post("/api/auth/request-password-reset", {
    email,
    redirectTo: origin + "/login?reset=1",
  });
  assert.equal(reset.status, 200, await reset.clone().text());
  const delivered = await (
    await fetch(origin + `/fixture/mail?email=${encodeURIComponent(email)}`)
  ).json();
  assert.equal(delivered.length, 2);
  assert.equal(delivered[1].transactions, 0);
  const state = (
    await pool.query(
      "SELECT state FROM quorem_auth.mail_intent WHERE purpose='account' ORDER BY created_at DESC LIMIT 1",
    )
  ).rows[0];
  assert.equal(state.state, "accepted");
  console.log(
    "PASS workerd registration proof, encrypted intents, account reset mail and delivery outside transactions",
  );
} finally {
  await pool.query('DELETE FROM quorem_auth."user" WHERE email=$1', [email]);
  await pool.query("DELETE FROM quorem_auth.registration_email WHERE email=$1", [email]);
  await pool.end();
}
