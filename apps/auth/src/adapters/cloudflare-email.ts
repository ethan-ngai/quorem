import type { EmailDelivery } from "../email-delivery.ts";

/** Cloudflare Email Service outbound API; requires an onboarded sender domain. */
export function cloudflareEmail(
  config: { accountId: string; apiToken: string; from: string },
  request: typeof fetch = fetch,
): EmailDelivery {
  return {
    async send(message) {
      try {
        // Do not retry ambiguous sends: the provider might already have accepted the email.
        const response = await request(
          `https://api.cloudflare.com/client/v4/accounts/${config.accountId}/email/sending/send`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${config.apiToken}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ from: config.from, ...message }),
            signal: AbortSignal.timeout(5000),
            redirect: "error",
          },
        );
        if (!response.ok) {
          await response.body?.cancel();
          throw new Error();
        }
        const reader = response.body?.getReader();
        if (!reader) throw new Error();
        let size = 0;
        const chunks: Uint8Array[] = [];
        try {
          if (Number(response.headers.get("content-length")) > 65536) {
            await reader.cancel();
            throw new Error();
          }
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            size += value.byteLength;
            if (size > 65536) {
              await reader.cancel();
              throw new Error();
            }
            chunks.push(value);
          }
        } finally {
          reader.releaseLock();
        }
        const body = JSON.parse(new TextDecoder().decode(Buffer.concat(chunks, size))) as {
          success?: unknown;
          result?: { delivered?: unknown; queued?: unknown; permanent_bounces?: unknown };
        } | null;
        const addresses = (value: unknown): string[] => {
          if (value === undefined) return [];
          if (!Array.isArray(value) || !value.every((address) => typeof address === "string"))
            throw new Error();
          return value;
        };
        if (
          body?.success !== true ||
          addresses(body.result?.permanent_bounces).includes(message.to) ||
          ![...addresses(body.result?.delivered), ...addresses(body.result?.queued)].includes(
            message.to,
          )
        )
          throw new Error();
      } catch {
        throw new Error("Email delivery unavailable");
      }
    },
  };
}
