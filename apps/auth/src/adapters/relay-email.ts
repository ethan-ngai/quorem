import { MailRejected, type EmailDelivery } from "../email-delivery.ts";

/** One authenticated request; ambiguous transport outcomes are never retried. */
export function relayEmail(
  config: { origin: string; token: string; from: string },
  send: typeof fetch = fetch,
): EmailDelivery {
  return {
    async send(message) {
      let response: Response;
      try {
        response = await send(new URL("/internal/mail/send", config.origin), {
          method: "POST",
          redirect: "manual",
          signal: AbortSignal.timeout(20000),
          headers: { authorization: `Bearer ${config.token}`, "content-type": "application/json" },
          body: JSON.stringify({ from: config.from, ...message }),
        });
      } catch {
        throw new Error("Email delivery unavailable");
      }
      const rejected =
        response.status === 422 && response.headers.get("x-quorem-mail-result") === "rejected";
      await response.body?.cancel().catch(() => {});
      if (rejected) throw new MailRejected("Email delivery rejected");
      if (response.status !== 204) throw new Error("Email delivery unavailable");
    },
  };
}
