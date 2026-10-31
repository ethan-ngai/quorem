import {
  ImageExecutionUncertain,
  type ImageFormat,
  type ImageProcessor,
} from "./image-processing.ts";
import { profileMutationLifetimeMs, type ProfileMutationBudget } from "./profile-budget.ts";
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
  profile_color?: number;
};
export class ProfileWriteUncertain extends Error {}
export interface ProfileRepository {
  read(id: string): Promise<Profile | undefined>;
  replace(id: string, previous: string | null, next: string | null): Promise<boolean>;
  contains(image: string): Promise<boolean>;
  setColor(id: string, color: number): Promise<void>;
}
type SessionReader = (headers: Headers) => Promise<{ user: { id: string } } | null>;
const json = (status: number, value: unknown) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
const publicProfile = ({ id, name, email, username, image, profile_color }: Profile) => ({
  id,
  color: profile_color,
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

async function boundedBody(request: Request, signal?: AbortSignal) {
  if (Number(request.headers.get("content-length")) > byteLimit) return undefined;
  const reader = request.body?.getReader();
  if (!reader) return undefined;
  const cancel = () => {
    void reader.cancel().catch(() => {});
  };
  signal?.addEventListener("abort", cancel, { once: true });
  if (signal?.aborted) cancel();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      signal?.throwIfAborted();
      const next = await reader.read();
      signal?.throwIfAborted();
      if (next.done) break;
      size += next.value.length;
      if (size > byteLimit) {
        await reader.cancel();
        return undefined;
      }
      chunks.push(next.value);
    }
  } finally {
    signal?.removeEventListener("abort", cancel);
    reader.releaseLock();
  }
  if (!size) return undefined;
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes;
}

export function createProfileHandler(options: {
  origin: string;
  session: SessionReader;
  repository: ProfileRepository;
  storage?: ProfileStorage;
  imageProcessor: ImageProcessor;
  budget: ProfileMutationBudget;
}) {
  if (!options.imageProcessor) throw new Error("Profile image processor is required");
  if (!options.budget) throw new Error("Profile mutation budget is required");
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
        ? new Response(new Uint8Array(image).buffer, {
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
      (pathname === "/api/auth/profile" && !["GET", "PATCH"].includes(request.method)) ||
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
    if (pathname === "/api/auth/profile") {
      let color: unknown;
      try {
        const bytes = await boundedBody(request);
        if (!bytes || bytes.length > 1024) return json(400, { error: "Invalid color" });
        color = (JSON.parse(new TextDecoder().decode(bytes)) as { color?: unknown }).color;
      } catch {
        return json(400, { error: "Invalid color" });
      }
      if (!Number.isInteger(color) || (color as number) < 1 || (color as number) > 24)
        return json(400, { error: "Invalid color" });
      await options.repository.setColor(profile.id, color as number);
      return json(200, publicProfile({ ...profile, profile_color: color as number }));
    }
    if (!options.storage) return json(503, { error: "Photo storage unavailable" });
    const admission = await options.budget.acquire(profile.id);
    if (!admission.allowed) return json(429, { error: "Try again shortly" });
    const signal = AbortSignal.any([
      request.signal,
      AbortSignal.timeout(
        Math.max(
          1,
          Math.min(profileMutationLifetimeMs, admission.lease.deadlineUnixMs - Date.now()),
        ),
      ),
    ]);
    let nextKey: string | undefined;
    let executionUncertain = false;
    try {
      signal.throwIfAborted();
      if (request.method === "PUT") {
        const format = (
          { "image/png": "png", "image/jpeg": "jpeg", "image/webp": "webp" } as Record<
            string,
            ImageFormat
          >
        )[request.headers.get("content-type") ?? ""];
        if (!format) return json(415, { error: "Choose a PNG, JPEG or WebP image" });
        const bytes = await boundedBody(request, signal);
        if (!bytes) return json(413, { error: "Choose an image smaller than 5 MiB" });
        const image = await options.imageProcessor.process(bytes, format, signal);
        signal.throwIfAborted();
        if (image.kind === "unsupported")
          return json(415, { error: "Choose a static PNG, JPEG or WebP image" });
        if (image.kind === "invalid") return json(422, { error: "Image could not be decoded" });
        nextKey = crypto.randomUUID();
        await options.storage.put(nextKey, image.bytes);
        signal.throwIfAborted();
      }
      const nextImage = nextKey ? photoPrefix + nextKey : null;
      if (!(await options.session(request.headers))) {
        await cleanup(nextKey);
        return json(401, { error: "Sign in required" });
      }
      signal.throwIfAborted();
      // Compare-and-set prevents parallel replacements from leaking orphaned objects.
      if (!(await options.repository.replace(profile.id, profile.image ?? null, nextImage))) {
        await cleanup(nextKey);
        return json(409, { error: "Profile changed; try again" });
      }
      await cleanup(storedKey(profile.image));
      return json(200, publicProfile({ ...profile, image: nextImage }));
    } catch (error) {
      if (error instanceof ImageExecutionUncertain) executionUncertain = true;
      if (!(error instanceof ProfileWriteUncertain)) await cleanup(nextKey);
      throw error;
    } finally {
      if (!executionUncertain) await options.budget.release(admission.lease);
    }
  };
}
