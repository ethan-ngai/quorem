/** Refuse public R2 domains before writing secret-bearing Terraform state. */
async function readResponse(response) {
  if (!response.ok || !response.body) throw new Error("State access check unavailable");
  const reader = response.body.getReader(),
    chunks = [];
  let size = 0;
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > 65536) {
        await reader.cancel();
        throw new Error("State access response too large");
      }
      chunks.push(part.value);
    }
  } finally {
    reader.releaseLock();
  }
  const result = JSON.parse(
    new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)),
  );
  if (
    result?.success !== true ||
    !Array.isArray(result.errors) ||
    result.errors.length !== 0 ||
    !result.result ||
    typeof result.result !== "object" ||
    Array.isArray(result.result)
  )
    throw new Error("Ambiguous state access response");
  return result.result;
}

/** Cloudflare encrypts all R2 objects at rest; this checks the separate public-domain controls. */
export async function requirePrivateStageState(env, send = fetch) {
  const account = env.CLOUDFLARE_ACCOUNT_ID,
    bucket = env.TF_STATE_BUCKET,
    token = env.CLOUDFLARE_API_TOKEN;
  if (
    !/^[a-f0-9]{32}$/.test(account ?? "") ||
    !/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(bucket ?? "") ||
    typeof token !== "string" ||
    token.length < 16 ||
    /\s/.test(token)
  )
    throw new Error("Invalid staged state configuration");
  const base = `https://api.cloudflare.com/client/v4/accounts/${account}/r2/buckets/${bucket}/domains`;
  const get = (path) =>
    send(`${base}/${path}`, {
      headers: { authorization: `Bearer ${token}` },
      redirect: "error",
      signal: AbortSignal.timeout(10000),
    }).then(readResponse);
  try {
    const managed = await get("managed"),
      custom = await get("custom");
    if (
      managed.enabled !== false ||
      typeof managed.bucketId !== "string" ||
      !/^[a-f0-9]{32}$/.test(managed.bucketId) ||
      typeof managed.domain !== "string" ||
      !/^[a-z0-9-]+\.r2\.dev$/.test(managed.domain) ||
      !Array.isArray(custom.domains) ||
      new Set(custom.domains.map((item) => item?.domain)).size !== custom.domains.length ||
      custom.domains.some(
        (item) =>
          !item || typeof item.domain !== "string" || !item.domain || item.enabled !== false,
      )
    )
      throw new Error("Public or ambiguous state access");
    return { account, bucket, managedPublic: false, customDomains: custom.domains.length };
  } catch {
    throw new Error("Private staged state could not be verified");
  }
}
