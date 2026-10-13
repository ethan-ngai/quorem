import { randomUUID } from "node:crypto";
import sharp from "sharp";
import type { ProfileStorage } from "./profile-storage.ts";

export const photoPrefix = "/api/auth/profile-photos/";
const keyPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const byteLimit = 5 * 1024 * 1024;
export type Profile = {
  id: string;
  name: string;
  email: string;
  username?: string | null;
  image?: string | null;
};
export interface ProfileRepository {
  read(id: string): Promise<Profile | undefined>;
  replace(id: string, previous: string | null, next: string | null): Promise<boolean>;
  contains(image: string): Promise<boolean>;
}
type SessionReader = (headers: Headers) => Promise<{ user: { id: string } } | null>;
const json = (status: number, value: unknown) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
const publicProfile = ({ name, email, username, image }: Profile) => ({
  name,
  email,
  username,
  image: storedKey(image) ? image : null,
});
const storedKey = (image: string | null | undefined) => {
  if (!image?.startsWith(photoPrefix)) return undefined;
  const key = image.slice(photoPrefix.length);
  return keyPattern.test(key) ? key : undefined;
};

async function boundedBody(request: Request) {
  if (Number(request.headers.get("content-length")) > byteLimit) return undefined;
  const reader = request.body?.getReader();
  if (!reader) return undefined;
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.length;
      if (size > byteLimit) {
        await reader.cancel();
        return undefined;
      }
      chunks.push(next.value);
    }
  } finally {
    reader.releaseLock();
  }
  return size ? Buffer.concat(chunks) : undefined;
}

export function createProfileHandler(options: {
  origin: string;
  session: SessionReader;
  repository: ProfileRepository;
  storage?: ProfileStorage;
}) {
  let processing = 0;
  const attempts = new Map<string, { starts: number; count: number }>();
  const cleanup = async (key: string | undefined) => {
    if (!key) return;
    try {
      await options.storage?.remove(key);
    } catch {
      console.error("Profile photo cleanup failed", key);
    }
  };
  return async (request: Request): Promise<Response | undefined> => {
    const pathname = new URL(request.url).pathname;
    if (pathname.startsWith(photoPrefix) && request.method === "GET") {
      const key = pathname.slice(photoPrefix.length);
      if (!keyPattern.test(key) || !(await options.repository.contains(photoPrefix + key)))
        return json(404, { error: "Photo not found" });
      if (!options.storage) return json(503, { error: "Photo storage unavailable" });
      const image = await options.storage.get(key);
      return image
        ? new Response(Buffer.from(image), {
            headers: {
              "Content-Type": "image/webp",
              "Cache-Control": "public, max-age=60",
              "X-Content-Type-Options": "nosniff",
              "Content-Security-Policy": "default-src 'none'",
            },
          })
        : json(404, { error: "Photo not found" });
    }
    if (pathname !== "/api/auth/profile" && pathname !== "/api/auth/profile-photo")
      return undefined;
    if (
      (pathname === "/api/auth/profile" && request.method !== "GET") ||
      (pathname === "/api/auth/profile-photo" && !["PUT", "DELETE"].includes(request.method))
    )
      return json(405, { error: "Method not allowed" });
    if (request.method !== "GET" && request.headers.get("origin") !== options.origin)
      return json(403, { error: "Invalid request origin" });
    const session = await options.session(request.headers);
    if (!session) return json(401, { error: "Sign in required" });
    const profile = await options.repository.read(session.user.id);
    if (!profile) return json(401, { error: "Sign in required" });
    if (request.method === "GET") return json(200, publicProfile(profile));
    if (!options.storage) return json(503, { error: "Photo storage unavailable" });
    const now = Date.now();
    for (const [id, window] of attempts) if (now - window.starts >= 60000) attempts.delete(id);
    const window = attempts.get(profile.id) ?? { starts: now, count: 0 };
    if (
      window.count >= 10 ||
      (!attempts.has(profile.id) && attempts.size >= 10000) ||
      processing >= 4
    )
      return json(429, { error: "Try again shortly" });
    window.count++;
    attempts.set(profile.id, window);
    processing++;
    let nextKey: string | undefined;
    try {
      if (request.method === "PUT") {
        const format = (
          { "image/png": "png", "image/jpeg": "jpeg", "image/webp": "webp" } as Record<
            string,
            string
          >
        )[request.headers.get("content-type") ?? ""];
        if (!format) return json(415, { error: "Choose a PNG, JPEG or WebP image" });
        const bytes = await boundedBody(request);
        if (!bytes) return json(413, { error: "Choose an image smaller than 5 MiB" });
        let image: Buffer;
        try {
          const source = sharp(bytes, { limitInputPixels: 16000000, failOn: "warning" });
          const metadata = await source.metadata();
          if (metadata.format !== format || (metadata.pages ?? 1) !== 1)
            return json(415, { error: "Choose a static PNG, JPEG or WebP image" });
          // Re-encoding strips metadata and active payloads; no original bytes are served.
          image = await source
            .rotate()
            .resize(512, 512, { fit: "cover", withoutEnlargement: true })
            .webp({ quality: 85 })
            .toBuffer();
        } catch {
          return json(422, { error: "Image could not be decoded" });
        }
        nextKey = randomUUID();
        await options.storage.put(nextKey, image);
      }
      const nextImage = nextKey ? photoPrefix + nextKey : null;
      if (!(await options.session(request.headers))) {
        await cleanup(nextKey);
        return json(401, { error: "Sign in required" });
      }
      // Compare-and-set prevents parallel replacements from leaking orphaned objects.
      if (!(await options.repository.replace(profile.id, profile.image ?? null, nextImage))) {
        await cleanup(nextKey);
        return json(409, { error: "Profile changed; try again" });
      }
      await cleanup(storedKey(profile.image));
      return json(200, publicProfile({ ...profile, image: nextImage }));
    } catch (error) {
      await cleanup(nextKey);
      throw error;
    } finally {
      processing--;
    }
  };
}
