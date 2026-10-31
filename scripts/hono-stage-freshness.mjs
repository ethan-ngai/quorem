/** Fresh namespace evidence is an authenticated provider inventory, not a history proof. */
async function body(response) {
  if (!response.ok || !response.body) throw new Error("Provider inventory unavailable");
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > 1024 * 1024) {
        await reader.cancel();
        throw new Error("Provider inventory too large");
      }
      chunks.push(next.value);
    }
  } finally {
    reader.releaseLock();
  }
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)));
}
async function inventory(account, token, path, send) {
  let total, pages;
  const entries = [];
  for (let page = 1; page <= 1000; page++) {
    const url = new URL(`https://api.cloudflare.com/client/v4/accounts/${account}/${path}`);
    url.searchParams.set("page", String(page));
    url.searchParams.set("per_page", "100");
    const result = await body(
      await send(url, {
        headers: { authorization: `Bearer ${token}` },
        redirect: "error",
        signal: AbortSignal.timeout(10000),
      }),
    );
    const info = result.result_info;
    if (
      result.success !== true ||
      !Array.isArray(result.result) ||
      !info ||
      info.page !== page ||
      info.per_page !== 100 ||
      !Number.isSafeInteger(info.total_pages) ||
      !Number.isSafeInteger(info.total_count) ||
      info.total_pages < 0 ||
      info.total_count < 0 ||
      info.count !== result.result.length ||
      result.result.length > 100 ||
      (total !== undefined && (total !== info.total_count || pages !== info.total_pages))
    )
      throw new Error("Ambiguous provider inventory");
    total = info.total_count;
    pages = info.total_pages;
    entries.push(...result.result);
    if (page >= Math.max(1, pages)) {
      if (
        entries.length !== total ||
        !(total === 0 ? [0, 1].includes(pages) : pages === Math.ceil(total / 100))
      )
        throw new Error("Incomplete provider inventory");
      return entries;
    }
  }
  throw new Error("Provider inventory page limit exceeded");
}
export async function requireFreshStageResources(env, send = fetch) {
  const account = env.CLOUDFLARE_ACCOUNT_ID,
    token = env.CLOUDFLARE_API_TOKEN;
  const service = env.HONO_SERVICES_WORKER_NAME,
    api = env.TF_VAR_worker_name;
  if (
    !/^[a-f0-9]{32}$/.test(account ?? "") ||
    typeof token !== "string" ||
    token.length < 16 ||
    !/^[a-z][a-z0-9-]*-hono-services-stage$/.test(service ?? "") ||
    !/^[a-z][a-z0-9-]*-hono-stage$/.test(api ?? "") ||
    service === api
  )
    throw new Error("Invalid staged provider inventory request");
  try {
    const workers = await inventory(account, token, "workers/workers", send);
    const namespaces = await inventory(account, token, "workers/durable_objects/namespaces", send);
    if (
      workers.some((row) => typeof row?.name !== "string" || typeof row?.id !== "string") ||
      namespaces.some((row) => typeof row?.id !== "string" || typeof row?.script !== "string")
    )
      throw new Error("Ambiguous provider inventory");
    if (
      new Set(workers.map((row) => row.id)).size !== workers.length ||
      new Set(namespaces.map((row) => row.id)).size !== namespaces.length
    )
      throw new Error("Duplicate provider inventory");
    if (
      workers.some((row) => row.name === service || row.name === api) ||
      namespaces.some((row) => row.script === service || row.script === api)
    )
      throw new Error("Stage resources already exist");
    return {
      account,
      service,
      api,
      workersChecked: workers.length,
      namespacesChecked: namespaces.length,
    };
  } catch {
    throw new Error("Stage resource freshness could not be established");
  }
}
