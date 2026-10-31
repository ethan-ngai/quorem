/** Refuse public R2 domains before writing secret-bearing Terraform state. */
async function readResponse(response, phase, report) {
  report(`${phase}_http`, { status: Number.isInteger(response?.status) ? response.status : 0 });
  if (!response?.body) throw new Error("State access check unavailable");
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
  let result;
  try {
    result = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)));
  } catch {
    report(`${phase}_metadata`, { parsed: false, bytes: size });
    throw new Error("Invalid state access response");
  }
  const errors = Array.isArray(result?.errors) ? result.errors : null;
  report(`${phase}_metadata`, {
    parsed: true,
    bytes: size,
    success: result?.success === true,
    errorsType: Array.isArray(result?.errors) ? "array" : typeof result?.errors,
    errorCodes: errors
      ? errors
          .map((entry) => entry?.code)
          .filter((code) => Number.isSafeInteger(code) && code >= 0)
          .slice(0, 10)
      : [],
    resultType:
      result?.result === null
        ? "null"
        : Array.isArray(result?.result)
          ? "array"
          : typeof result?.result,
  });
  if (
    !response.ok ||
    result?.success !== true ||
    !errors ||
    errors.length !== 0 ||
    !result.result ||
    typeof result.result !== "object" ||
    Array.isArray(result.result)
  )
    throw new Error("Ambiguous state access response");
  return result.result;
}

/** Cloudflare encrypts all R2 objects at rest; this checks the separate public-domain controls. */
export async function requirePrivateStageState(env, send = fetch, observe = () => {}) {
  const report = (phase, metadata) => {
    try {
      observe(phase, metadata);
    } catch {}
  };
  const account = env.CLOUDFLARE_ACCOUNT_ID,
    bucket = env.TF_STATE_BUCKET,
    token = env.CLOUDFLARE_API_TOKEN;
  const validAccount = /^[a-f0-9]{32}$/.test(account ?? ""),
    validBucket = /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(bucket ?? ""),
    validToken = typeof token === "string" && token.length >= 16 && !/\s/.test(token);
  report("configuration", { validAccount, validBucket, validToken });
  if (!validAccount || !validBucket || !validToken)
    throw new Error("Invalid staged state configuration");
  const base = `https://api.cloudflare.com/client/v4/accounts/${account}/r2/buckets/${bucket}/domains`;
  const get = (path) =>
    send(`${base}/${path}`, {
      headers: { authorization: `Bearer ${token}` },
      redirect: "error",
      signal: AbortSignal.timeout(10000),
    }).then((response) => readResponse(response, path, report));
  try {
    const managed = await get("managed");
    report("managed_policy", {
      enabledType: typeof managed.enabled,
      disabled: managed.enabled === false,
    });
    if (managed.enabled !== false) throw new Error("Managed state access is public or ambiguous");
    const custom = await get("custom");
    const validDomains =
      Array.isArray(custom.domains) &&
      new Set(custom.domains.map((item) => item?.domain)).size === custom.domains.length &&
      custom.domains.every(
        (item) =>
          item &&
          typeof item.domain === "string" &&
          item.domain.length > 0 &&
          item.enabled === false,
      );
    report("custom_policy", {
      domainsType: Array.isArray(custom.domains) ? "array" : typeof custom.domains,
      count: Array.isArray(custom.domains) ? custom.domains.length : 0,
      allDisabled: validDomains,
    });
    if (!validDomains) throw new Error("Custom state access is public or ambiguous");
    return { account, bucket, managedPublic: false, customDomains: custom.domains.length };
  } catch {
    throw new Error("Private staged state could not be verified");
  }
}
