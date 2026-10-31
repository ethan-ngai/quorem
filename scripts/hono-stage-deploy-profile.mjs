/** Public 40px PNG; verify the real staged profile/R2/image-service path. */
export const profileProbePNG = Uint8Array.from(
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAACgAAAAoCAIAAAADnC86AAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAS0lEQVRYhe3YQQ0AMAxC0WlBC1rwL2EedtnlJb03IS0/cNJ9mWNxSR3HNe9UBhKWOZAoLA4WC4uBxcFiYTGwKC1OMK8qIsqXPWtwAegj+z0YdafWAAAAAElFTkSuQmCC",
    "base64",
  ),
);
export async function verifyHostedProfile(env, send = fetch) {
  const api = new URL(env.HONO_STAGE_API_ORIGIN);
  if (
    api.protocol !== "https:" ||
    api.origin !== env.HONO_STAGE_API_ORIGIN ||
    !/(^|-)stag(e|ing)(-|$)/.test(api.hostname.split(".")[0]) ||
    !env.HONO_STAGE_SESSION_COOKIE ||
    /[\r\n]/.test(env.HONO_STAGE_SESSION_COOKIE)
  )
    throw new Error("Invalid stage profile fixture");
  const headers = {
    cookie: env.HONO_STAGE_SESSION_COOKIE,
    origin: api.origin,
    "content-type": "image/png",
  };
  let uploaded = false,
    failure,
    cleanupFailed = false;
  try {
    const response = await send(`${api.origin}/api/auth/profile-photo`, {
      method: "PUT",
      headers,
      body: profileProbePNG,
      redirect: "error",
      signal: AbortSignal.timeout(30000),
    });
    if (response.status !== 200 || !response.body) throw new Error("Stage profile upload failed");
    uploaded = true;
    const reader = response.body.getReader(),
      parts = [];
    let size = 0;
    try {
      for (;;) {
        const part = await reader.read();
        if (part.done) break;
        size += part.value.length;
        if (size > 16384) {
          await reader.cancel();
          throw new Error("Invalid profile response");
        }
        parts.push(part.value);
      }
    } finally {
      reader.releaseLock();
    }
    const profile = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(parts)),
    );
    if (!/^\/api\/auth\/profile-photos\/[a-f0-9-]{36}$/.test(profile.image ?? ""))
      throw new Error("Invalid stage photo");
    const photo = await send(`${api.origin}${profile.image}`, {
      redirect: "error",
      signal: AbortSignal.timeout(30000),
    });
    if (photo.status !== 200 || photo.headers.get("content-type") !== "image/webp")
      throw new Error("Stage profile read failed");
    await photo.body?.cancel();
  } catch (error) {
    failure = error;
  } finally {
    if (uploaded) {
      try {
        const removed = await send(`${api.origin}/api/auth/profile-photo`, {
          method: "DELETE",
          headers,
          redirect: "error",
          signal: AbortSignal.timeout(30000),
        });
        if (removed.status !== 200) cleanupFailed = true;
        await removed.body?.cancel();
      } catch {
        cleanupFailed = true;
      }
    }
  }
  if (cleanupFailed) throw new Error("Stage profile cleanup failed");
  if (failure) throw failure;
}
