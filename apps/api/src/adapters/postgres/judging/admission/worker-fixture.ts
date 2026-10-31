// @ts-expect-error Workerd provides this module at runtime.
import { DurableObject } from "cloudflare:workers";
import { withWorkerConnection } from "@quorem/database/core";
import { prearmReceipts } from "../../events/scheduling/prearm.ts";
import { postgresDispatch } from "../../events/dispatch.ts";
import { dispatchBatch } from "../../../../modules/events/dispatch/dispatch.ts";
import {
  AdmissionRecovery,
  type AdmissionAlarmStorage,
} from "../../../../modules/judging/admission/recovery.ts";
export class ExecutionRecoveryFixture extends DurableObject {
  actor: AdmissionRecovery;
  constructor(state: { storage: AdmissionAlarmStorage }, env: { ADMISSION_DATABASE_URL: string }) {
    super(state, env);
    const url = new URL(env.ADMISSION_DATABASE_URL);
    if (
      !["postgres:", "postgresql:"].includes(url.protocol) ||
      !!url.hash ||
      [...url.searchParams.keys()].some((key) =>
        ["host", "hostaddr", "service"].includes(key.toLowerCase()),
      ) ||
      url.pathname !== "/quorem_hono_admission_test" ||
      !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)
    )
      throw new Error("Disposable admission database required");
    const run = <T>(fn: Parameters<typeof withWorkerConnection<T>>[2]) =>
      withWorkerConnection(
        env.ADMISSION_DATABASE_URL,
        { connectionTimeoutMs: 3000, lifetimeMs: 10000 },
        fn,
      );
    this.actor = new AdmissionRecovery(state.storage, prearmReceipts(run, "execution"), () =>
      dispatchBatch(
        postgresDispatch(run),
        { publish: async () => {} },
        {
          send: async (wake) => {
            await state.storage.put("published", wake.jobId);
          },
        },
        "execution",
      ),
    );
  }
  prearm(shard: number) {
    return this.actor.prearm(shard);
  }
  wake(shard: number) {
    return this.actor.wake(shard);
  }
  alarm() {
    return this.actor.alarm();
  }
}
export default { fetch: () => new Response("fixture") };
