import { test } from "node:test";
import assert from "node:assert/strict";
import { verifyPrivateIngress } from "./hono-stage-deploy-ingress.mjs";
const env = () => ({
  QUOREM_CASE_ORIGIN: "https://case-stage.example.com",
  VERIFICATION_SERVICE_ORIGIN: "https://verify-stage.example.com",
  HONO_STAGE_API_ORIGIN: "https://api-stage.example.com",
  HONO_DRAIN_ORIGIN: "https://drain-stage.example.com",
  QUOREM_CASE_SECRET: "c".repeat(32),
  VERIFICATION_SERVICE_CREDENTIAL: "a".repeat(64),
  VERIFICATION_SOURCE_CREDENTIAL: "b".repeat(64),
  EXECUTION_DRAIN_SECRET: "d".repeat(32),
});
void test("requires valid bearer on every private origin, including a background drain", async () => {
  const calls = [];
  const input = env();
  const valid = new Set([
    input.VERIFICATION_SERVICE_CREDENTIAL,
    input.VERIFICATION_SOURCE_CREDENTIAL,
    input.EXECUTION_DRAIN_SECRET,
  ]);
  await verifyPrivateIngress(
    input,
    "a".repeat(64),
    async (url, init) => {
      const headers = new Headers(init.headers),
        token = headers.get("authorization")?.replace("Bearer ", "");
      calls.push({
        url: typeof url === "string" ? url : url instanceof URL ? url.href : url.url,
        headers,
      });
      if (!valid.has(token)) return new Response(null, { status: 404 });
      return new Response(null, {
        status: (typeof url === "string" ? url : url instanceof URL ? url.href : url.url).includes(
          "/internal/drain",
        )
          ? 202
          : 503,
      });
    },
    async () => ({ namespace: "a".repeat(64) }),
  );
  assert.equal(calls.length, 11);
  assert.ok(calls.every(({ headers }) => !headers.has("cf-access-client-id")));
  assert.equal(calls.filter(({ headers }) => !headers.has("authorization")).length, 4);
});
void test("rejects a private endpoint accepting wrong credentials or changed namespace", async () => {
  await assert.rejects(
    verifyPrivateIngress(
      env(),
      "a".repeat(64),
      async () => new Response(null, { status: 404 }),
      async () => ({ namespace: "a".repeat(64) }),
    ),
    /Authenticated ingress control failed/,
  );
  await assert.rejects(
    verifyPrivateIngress(
      env(),
      "a".repeat(64),
      async () => new Response(null, { status: 200 }),
      async () => ({ namespace: "a".repeat(64) }),
    ),
  );
  await assert.rejects(
    verifyPrivateIngress(
      env(),
      "a".repeat(64),
      async () => {
        throw new Error("must not call");
      },
      async () => ({ namespace: "b".repeat(64) }),
    ),
    /changed/,
  );
});
void test("image requires terminated authenticated processing and denies missing and wrong credentials", async () => {
  const input = {
    ...env(),
    PROFILE_MEDIA_ENABLED: "true",
    PROFILE_IMAGE_SERVICE_URL: "https://image-stage.example.com",
    PROFILE_IMAGE_SERVICE_TOKEN: "i".repeat(32),
  };
  await verifyPrivateIngress(
    input,
    "a".repeat(64),
    async (url, init) => {
      const token = new Headers(init.headers).get("authorization")?.replace("Bearer ", "");
      if (
        ![
          input.VERIFICATION_SERVICE_CREDENTIAL,
          input.VERIFICATION_SOURCE_CREDENTIAL,
          input.EXECUTION_DRAIN_SECRET,
          input.PROFILE_IMAGE_SERVICE_TOKEN,
        ].includes(token)
      )
        return new Response(null, { status: 403 });
      if (
        (typeof url === "string" ? url : url instanceof URL ? url.href : url.url).includes(
          "image-stage",
        )
      )
        return new Response("ok", { headers: { "x-image-execution": "terminated" } });
      return new Response(null, {
        status: (typeof url === "string" ? url : url instanceof URL ? url.href : url.url).includes(
          "/internal/drain",
        )
          ? 200
          : 503,
      });
    },
    async () => ({ namespace: "a".repeat(64) }),
  );
});
