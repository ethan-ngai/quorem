/** Native test composition with a cryptographic fixture issuer and real PostgreSQL domain owners. */
import { jwtVerify } from "jose";
import { withWorkerConnection, type ConnectionScope } from "@quorem/database/core";
import { IdentityError, type Claims } from "../../../modules/identity/model.ts";
import { matchLifecycle } from "../../../adapters/postgres/matches/lifecycle/repository.ts";
import { prearmReceipts } from "../../../adapters/postgres/events/scheduling/prearm.ts";
import { submissionSnapshots } from "../../../adapters/postgres/judging/results/repository.ts";
import { postgresSocketAuthority } from "./authority.ts";
import { browserSocketObject } from "./durable.ts";
interface Env {
  DATABASE: string;
  SOCKET: {
    idFromName(name: string): unknown;
    get(id: unknown): { fetch(request: Request): Promise<Response> };
  };
}
const runFor =
  (env: Env) =>
  <T>(f: (scope: ConnectionScope) => Promise<T>) =>
    withWorkerConnection(env.DATABASE, { lifetimeMs: 5000, connectionTimeoutMs: 2000 }, f);
export class BrowserSocketFixture extends browserSocketObject<Env>((env) => {
  const run = runFor(env);
  const matches = matchLifecycle(run, {
    inviteKey: new Uint8Array(32).fill(7),
    receipts: prearmReceipts(run),
    coordinator: {
      prearm: async () => {
        throw new Error("fixture has no scheduler");
      },
      wake: async () => {
        throw new Error("fixture has no scheduler");
      },
    },
    shards: 1,
    guestCreation: true,
  });
  return {
    origins: ["https://example.test"],
    authority: postgresSocketAuthority({
      run,
      matches,
      submissions: submissionSnapshots(run),
      sessions: { check: async () => ({}) },
      verifier: {
        async verify(token): Promise<Claims> {
          try {
            const { payload } = await jwtVerify(
              token,
              new TextEncoder().encode("0123456789abcdef0123456789abcdef"),
              { issuer: "socket-test" },
            );
            if (
              typeof payload.sub !== "string" ||
              typeof payload.sid !== "string" ||
              typeof payload.exp !== "number"
            )
              throw new Error("claims");
            return {
              issuer: "socket-test",
              subject: payload.sub,
              sessionId: payload.sid,
              expiresAt: payload.exp,
              issuedAt: 0,
              emailVerified: true,
              name: "Fixture",
              image: "",
              color: 0,
              colorRevision: 0n,
            };
          } catch (error) {
            throw new IdentityError("unauthorized", error);
          }
        },
      },
    }),
  };
}) {}
export default {
  fetch(request: Request, env: Env) {
    return env.SOCKET.get(
      env.SOCKET.idFromName(new URL(request.url).searchParams.get("shard") ?? "fixture"),
    ).fetch(request);
  },
};
