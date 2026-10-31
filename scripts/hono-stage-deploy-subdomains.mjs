/** Verify Cloudflare reports neither workers.dev nor previews enabled. */
export async function verifyNoAlternateIngress(env, send = fetch) {
  if (
    !/^[a-f0-9]{32}$/.test(env.CLOUDFLARE_ACCOUNT_ID ?? "") ||
    !env.CLOUDFLARE_API_TOKEN ||
    /\s/.test(env.CLOUDFLARE_API_TOKEN) ||
    !/^[a-z][a-z0-9-]*-hono-stage$/.test(env.TF_VAR_worker_name ?? "") ||
    !/^[a-z][a-z0-9-]*-hono-services-stage$/.test(env.HONO_SERVICES_WORKER_NAME ?? "")
  )
    throw new Error("Invalid staged Worker identity");
  for (const name of [env.TF_VAR_worker_name, env.HONO_SERVICES_WORKER_NAME]) {
    const response = await send(
      `https://api.cloudflare.com/client/v4/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/workers/scripts/${name}/subdomain`,
      {
        headers: { authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}` },
        redirect: "error",
        signal: AbortSignal.timeout(10000),
      },
    );
    if (!response.ok || !response.body) throw new Error("Worker subdomain verification failed");
    const reader = response.body.getReader(),
      parts = [];
    let total = 0;
    try {
      for (;;) {
        const part = await reader.read();
        if (part.done) break;
        total += part.value.length;
        if (total > 16384) {
          await reader.cancel();
          throw new Error("Invalid subdomain response");
        }
        parts.push(part.value);
      }
    } finally {
      reader.releaseLock();
    }
    const body = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(parts)));
    if (
      body.success !== true ||
      body.result?.enabled !== false ||
      body.result?.previews_enabled !== false
    )
      throw new Error("Alternate Worker ingress is enabled or unknown");
  }
}
