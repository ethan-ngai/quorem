import { withNodeConnection } from "@quorem/database/core";
import { drizzleProfileBudget } from "./adapters/drizzle-profile-budget.ts";
import { drizzleProfileRepository } from "./adapters/drizzle-profile-repository.ts";
import { createHmac, randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { sharpImageProcessor } from "./adapters/sharp-image";
import { createProfileHandler, photoPrefix, type Profile } from "./profile";
import { migrateAuth } from "./migrations";
function testBudget() {
  let count = 0;
  return {
    async acquire() {
      if (count >= 10) return { allowed: false as const, retryAfterSeconds: 1 };
      count++;
      return {
        allowed: true as const,
        lease: {
          id: crypto.randomUUID(),
          ownerHash: "fixture",
          generation: crypto.randomUUID(),
          deadlineUnixMs: Date.now() + 15000,
        },
      };
    },
    async release() {},
  };
}
const origin = "http://127.0.0.1:5174";
const png = () =>
  sharp({ create: { width: 32, height: 16, channels: 3, background: "red" } })
    .png()
    .toBuffer();
function fixture(image: string | null = null) {
  let profile: Profile = {
    id: "alice",
    name: "Alice",
    username: "alice",
    email: "alice@example.test",
    image,
  };
  const objects = new Map<string, Uint8Array>();
  let failUpdate = false;
  const handler = createProfileHandler({
    budget: testBudget(),
    origin,
    imageProcessor: sharpImageProcessor,
    session: async (headers) =>
      headers.get("cookie") === "session=alice" ? { user: { id: "alice" } } : null,
    repository: {
      read: async () => profile,
      setColor: async (_id, color) => {
        profile = { ...profile, profile_color: color };
      },
      contains: async (image) => image === profile.image,
      replace: async (id, previous, next) => {
        if (failUpdate) throw new Error("database unavailable");
        if (id !== profile.id || previous !== profile.image) return false;
        profile = { ...profile, image: next };
        return true;
      },
    },
    storage: {
      put: async (key, image) => {
        objects.set(key, image);
      },
      get: async (key) => objects.get(key),
      remove: async (key) => {
        objects.delete(key);
      },
    },
  });
  const call = (
    method: string,
    body?: Uint8Array,
    type = "image/png",
    requestOrigin = origin,
    cookie = "session=alice",
  ) =>
    handler(
      new Request(origin + "/api/auth/profile-photo", {
        method,
        headers: { Origin: requestOrigin, Cookie: cookie, "Content-Type": type },
        ...(body ? { body: Buffer.from(body) } : {}),
      }),
    );
  return {
    call,
    handler,
    objects,
    failUpdate: () => {
      failUpdate = true;
    },
  };
}
describe("profile photos", () => {
  it("holds admission until uncancellable processing settles after abort", async () => {
    let finish!: (result: { kind: "invalid" }) => void;
    let started!: () => void;
    const processingStarted = new Promise<void>((resolve) => {
      started = resolve;
    });
    const processing = new Promise<{ kind: "invalid" }>((resolve) => {
      finish = resolve;
    });
    let released = 0;
    let stored = 0;
    const controller = new AbortController();
    const handler = createProfileHandler({
      origin,
      budget: {
        ...testBudget(),
        release: async () => {
          released++;
        },
      },
      session: async () => ({ user: { id: "alice" } }),
      repository: {
        read: async () => ({ id: "alice", name: "A", email: "a@example.test" }),
        replace: async () => true,
        contains: async () => false,
        setColor: async () => {},
      },
      storage: {
        put: async () => {
          stored++;
        },
        get: async () => undefined,
        remove: async () => {},
      },
      imageProcessor: {
        process: async () => {
          started();
          return processing;
        },
      },
    });
    const result = handler(
      new Request(origin + "/api/auth/profile-photo", {
        method: "PUT",
        headers: { Origin: origin, "Content-Type": "image/png" },
        body: "fixture",
        signal: controller.signal,
      }),
    );
    await processingStarted;
    controller.abort();
    expect(released).toBe(0);
    finish({ kind: "invalid" });
    await expect(result).rejects.toThrow();
    expect(released).toBe(1);
    expect(stored).toBe(0);
  });
  it("requires an image processor at composition", () => {
    expect(() => createProfileHandler({} as Parameters<typeof createProfileHandler>[0])).toThrow(
      "Profile image processor is required",
    );
  });
  it("identifies the cookie owner for matching speculative profile reads", async () => {
    const response = await fixture().handler(
      new Request(origin + "/api/auth/profile", { headers: { Cookie: "session=alice" } }),
    );
    expect(await response!.json()).toMatchObject({ id: "alice", name: "Alice" });
  });
  it("validates and saves account colors with origin and session checks", async () => {
    let color = 4;
    const handler = createProfileHandler({
      budget: testBudget(),
      origin,
      imageProcessor: sharpImageProcessor,
      session: async (headers) => (headers.get("cookie") ? { user: { id: "alice" } } : null),
      repository: {
        read: async () => ({
          id: "alice",
          name: "Alice",
          email: "a@example.test",
          profile_color: color,
        }),
        contains: async () => false,
        replace: async () => false,
        setColor: async (_id, value) => {
          color = value;
        },
      },
    });
    const call = (body: string, requestOrigin = origin, cookie = "session") =>
      handler(
        new Request(origin + "/api/auth/profile", {
          method: "PATCH",
          headers: { Origin: requestOrigin, Cookie: cookie },
          body,
        }),
      );
    expect((await call('{"color":25}'))?.status).toBe(400);
    expect((await call('{"color":3}', "https://evil.test"))?.status).toBe(403);
    expect((await call('{"color":3}', origin, ""))?.status).toBe(401);
    const result = await call('{"color":3}');
    expect((await result!.json()).color).toBe(3);
    expect(color).toBe(3);
  });
  it("returns no image for legacy remote URLs and embedded image data", async () => {
    for (const image of [
      "https://example.test/photo.jpg",
      "data:image/png;base64,AAAA",
      photoPrefix + "invalid",
    ]) {
      const f = fixture(image);
      const response = await f.handler(
        new Request(origin + "/api/auth/profile", { headers: { Cookie: "session=alice" } }),
      );
      expect((await response!.json()).image).toBeNull();
    }
  });
  it("decodes, strips source bytes, replaces old object and removes published image", async () => {
    const f = fixture();
    const uploaded = await f.call("PUT", await png());
    expect(uploaded?.status).toBe(200);
    const first = (await uploaded!.json()).image as string;
    const served = await f.handler(new Request(origin + first));
    expect(served?.headers.get("content-type")).toBe("image/webp");
    const metadata = await sharp(Buffer.from(await served!.arrayBuffer())).metadata();
    expect(metadata.format).toBe("webp");
    expect(metadata.exif).toBeUndefined();
    expect(f.objects.size).toBe(1);
    expect((await f.call("PUT", await png()))?.status).toBe(200);
    expect(f.objects.size).toBe(1);
    expect((await f.handler(new Request(origin + first)))?.status).toBe(404);
    expect((await f.call("DELETE"))?.status).toBe(200);
    expect(f.objects.size).toBe(0);
  });
  it("requires a live session and exact mutation origin", async () => {
    const f = fixture();
    expect((await f.call("PUT", await png(), "image/png", origin, ""))?.status).toBe(401);
    expect((await f.call("PUT", await png(), "image/png", "https://evil.test"))?.status).toBe(403);
    expect((await f.call("DELETE", undefined, "image/png", ""))?.status).toBe(403);
    expect(f.objects.size).toBe(0);
  });
  it("rejects SVG, mislabelled images, malformed bytes and oversized bodies", async () => {
    const f = fixture();
    expect((await f.call("PUT", Buffer.from("<svg/>"), "image/svg+xml"))?.status).toBe(415);
    expect((await f.call("PUT", await png(), "image/jpeg"))?.status).toBe(415);
    expect((await f.call("PUT", Buffer.from("invalid")))?.status).toBe(422);
    expect((await f.call("PUT", new Uint8Array(5 * 1024 * 1024 + 1)))?.status).toBe(413);
    expect(f.objects.size).toBe(0);
  });
  it("enforces pixel limits before transformation", async () => {
    const f = fixture();
    const huge = await sharp({
      create: { width: 4001, height: 4001, channels: 3, background: "blue" },
    })
      .png()
      .toBuffer();
    expect((await f.call("PUT", huge))?.status).toBe(422);
    expect(f.objects.size).toBe(0);
  });
  it("cleans uploaded objects if persisting profile fails", async () => {
    const f = fixture();
    f.failUpdate();
    await expect(f.call("PUT", await png())).rejects.toThrow("database unavailable");
    expect(f.objects.size).toBe(0);
  });
  it("parallel replacements retain only the successful object", async () => {
    const f = fixture();
    const bytes = await png();
    const responses = await Promise.all([f.call("PUT", bytes), f.call("PUT", bytes)]);
    expect(responses.map((response) => response!.status).sort((a, b) => a - b)).toEqual([200, 409]);
    expect(f.objects.size).toBe(1);
  });
  it("never retrieves unreferenced keys or arbitrary paths", async () => {
    const f = fixture();
    expect((await f.handler(new Request(origin + photoPrefix + randomUUID())))?.status).toBe(404);
    expect((await f.handler(new Request(origin + photoPrefix + "garbage")))?.status).toBe(404);
  });
  it("bounds per-user mutation attempts", async () => {
    const f = fixture();
    for (let i = 0; i < 10; i++) expect((await f.call("DELETE"))?.status).toBe(200);
    expect((await f.call("DELETE"))?.status).toBe(429);
  });
});
const databaseURL = process.env.AUTH_TEST_DATABASE_URL;
describe.skipIf(!databaseURL)("profile with real Better Auth session", () => {
  it("uses cookie subject and refuses revoked sessions", async () => {
    Object.assign(process.env, {
      APP_ENV: "local",
      AUTH_MODE: "password",
      AUTH_ORIGIN: origin,
      BETTER_AUTH_SECRET: "mock-secret-".repeat(4),
      AUTH_DATABASE_URL: databaseURL,
      AUTH_INTERNAL_SECRET: "mock-internal",
    });
    const runtime = await (await import("./node-auth")).createNodeRuntime(process.env);
    const { database, config, auth } = runtime;
    await migrateAuth(database);
    const id = randomUUID(),
      sessionId = randomUUID(),
      token = randomUUID();
    try {
      await database.query(
        'INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$2,$3,true,NOW(),NOW())',
        [id, "Photo user", `${id}@example.test`],
      );
      await database.query(
        'INSERT INTO "session"(id,token,"userId","expiresAt","createdAt","updatedAt") VALUES($1,$2,$3,NOW()+interval \'1 hour\',NOW(),NOW())',
        [sessionId, token, id],
      );
      const signature = createHmac("sha256", config.secret).update(token).digest("base64");
      const cookie = `better-auth.session_token=${encodeURIComponent(`${token}.${signature}`)}`;
      const objects = new Map<string, Uint8Array>();
      const run = <T>(callback: Parameters<typeof withNodeConnection<T>>[2]) =>
        withNodeConnection(database, { lifetimeMs: 15000 }, callback);
      const handler = createProfileHandler({
        budget: drizzleProfileBudget(run),
        origin,
        imageProcessor: sharpImageProcessor,
        session: (headers) => auth.api.getSession({ headers }),
        repository: drizzleProfileRepository(run),
        storage: {
          put: async (key, bytes) => {
            objects.set(key, bytes);
          },
          get: async (key) => objects.get(key),
          remove: async (key) => {
            objects.delete(key);
          },
        },
      });
      const upload = await handler(
        new Request(origin + "/api/auth/profile-photo?userId=bob", {
          method: "PUT",
          headers: { Cookie: cookie, Origin: origin, "Content-Type": "image/png" },
          body: await png(),
        }),
      );
      expect(upload?.status).toBe(200);
      const image = (await upload!.json()).image;
      expect(
        (await database.query('SELECT image FROM "user" WHERE id=$1', [id])).rows[0].image,
      ).toBe(image);
      for (const injected of [
        "https://example.test/photo.jpg",
        "data:image/png;base64,AAAA",
        photoPrefix + randomUUID(),
        null,
      ]) {
        const bypass = await auth.handler(
          new Request(origin + "/api/auth/update-user", {
            method: "POST",
            headers: { Cookie: cookie, Origin: origin, "Content-Type": "application/json" },
            body: JSON.stringify({ image: injected }),
          }),
        );
        expect(bypass.status).toBe(400);
        expect(
          (await database.query('SELECT image FROM "user" WHERE id=$1', [id])).rows[0].image,
        ).toBe(image);
      }
      const rename = await auth.handler(
        new Request(origin + "/api/auth/update-user", {
          method: "POST",
          headers: { Cookie: cookie, Origin: origin, "Content-Type": "application/json" },
          body: JSON.stringify({ name: "Updated name" }),
        }),
      );
      expect(rename.status).toBe(200);
      await database.query('DELETE FROM "session" WHERE id=$1', [sessionId]);
      expect(
        (
          await handler(
            new Request(origin + "/api/auth/profile-photo", {
              method: "DELETE",
              headers: { Cookie: cookie, Origin: origin },
            }),
          )
        )?.status,
      ).toBe(401);
      expect(objects.size).toBe(1);
    } finally {
      await database.query('DELETE FROM "user" WHERE id=$1', [id]);
      await database.end();
    }
  });
});
